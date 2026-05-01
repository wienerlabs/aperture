import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { buildPoseidon, type Poseidon } from 'circomlibjs';
import type { Policy, TimeRestriction } from '@aperture/types';

// === Circuit shape constants =================================================
// Must match the template parameters used in
// circuits/payment-prover/payment.circom (Adım 4b will pin the new circuit to
// these same values). When the circuit is regenerated with different sizes,
// these constants and the policy_data_hash on every existing on-chain
// PolicyAccount must change in lockstep.
const MAX_WHITELIST = 10;
const MAX_BLOCKED = 10;
const MAX_CATEGORIES = 8;

// === Poseidon singleton ======================================================
// circomlibjs builds the Poseidon constants tables on the first call (~50ms);
// subsequent calls reuse the same instance.
let poseidonPromise: Promise<Poseidon> | null = null;

async function getPoseidon(): Promise<Poseidon> {
  if (!poseidonPromise) {
    poseidonPromise = buildPoseidon();
  }
  return poseidonPromise;
}

function poseidonHashToHex(poseidon: Poseidon, inputs: bigint[]): string {
  const out = poseidon(inputs);
  // poseidon.F.toString produces the field element as a decimal string;
  // convert to a 32-byte big-endian hex so it lines up with the [u8;32]
  // representation the on-chain PolicyAccount stores.
  const decimal = poseidon.F.toString(out);
  return BigInt(decimal).toString(16).padStart(64, '0');
}

function poseidonHashAsBigInt(poseidon: Poseidon, inputs: bigint[]): bigint {
  const out = poseidon(inputs);
  return BigInt(poseidon.F.toString(out));
}

/**
 * Merkle tree implementation for policy rule storage.
 *
 * Each policy rule becomes a leaf node. The tree enables selective disclosure:
 * prove a specific rule exists in the policy without revealing other rules.
 *
 * Leaf format: SHA256("rule_name:" + canonical_value)
 * Internal nodes: SHA256(left_child + right_child) with sorted pair ordering
 */

export interface MerkleTree {
  readonly root: Buffer;
  readonly leaves: readonly Buffer[];
  readonly layers: readonly (readonly Buffer[])[];
  readonly labels: readonly string[];
}

export interface MerkleProof {
  readonly leaf: string;
  readonly label: string;
  readonly proof: readonly string[];
  readonly directions: readonly ('left' | 'right')[];
  readonly root: string;
}

function sha256(data: Buffer | string): Buffer {
  return createHash('sha256').update(data).digest();
}

function hashLeaf(label: string, value: string): Buffer {
  return sha256(`${label}:${value}`);
}

function hashPair(left: Buffer, right: Buffer): Buffer {
  // Sort pair to ensure consistent ordering regardless of position
  if (Buffer.compare(left, right) > 0) {
    return sha256(Buffer.concat([right, left]));
  }
  return sha256(Buffer.concat([left, right]));
}

/**
 * Converts a policy into Merkle tree leaves.
 * Each rule type becomes one leaf with a deterministic hash.
 */
export function policyToLeaves(policy: Policy): { leaves: Buffer[]; labels: string[] } {
  const LAMPORTS_PER_UNIT = 1_000_000;

  const leaves: Buffer[] = [];
  const labels: string[] = [];

  // Leaf 0: max_daily_spend
  const dailyLamports = Math.round(policy.max_daily_spend * LAMPORTS_PER_UNIT);
  leaves.push(hashLeaf('max_daily_spend', dailyLamports.toString()));
  labels.push('max_daily_spend');

  // Leaf 1: max_per_transaction
  const perTxLamports = Math.round(policy.max_per_transaction * LAMPORTS_PER_UNIT);
  leaves.push(hashLeaf('max_per_transaction', perTxLamports.toString()));
  labels.push('max_per_transaction');

  // Leaf 2: allowed_endpoint_categories (sorted for determinism)
  const categories = [...policy.allowed_endpoint_categories].sort();
  leaves.push(hashLeaf('allowed_categories', JSON.stringify(categories)));
  labels.push('allowed_categories');

  // Leaf 3: blocked_addresses (sorted for determinism)
  const blocked = [...policy.blocked_addresses].sort();
  leaves.push(hashLeaf('blocked_addresses', JSON.stringify(blocked)));
  labels.push('blocked_addresses');

  // Leaf 4: token_whitelist (sorted for determinism)
  const tokens = [...policy.token_whitelist].sort();
  leaves.push(hashLeaf('token_whitelist', JSON.stringify(tokens)));
  labels.push('token_whitelist');

  // Leaf 5: time_restrictions (canonical JSON)
  const timeRestrictions = policy.time_restrictions ?? [];
  leaves.push(hashLeaf('time_restrictions', JSON.stringify(timeRestrictions)));
  labels.push('time_restrictions');

  return { leaves, labels };
}

/**
 * Builds a binary Merkle tree from a list of leaves.
 * If the number of leaves is odd, the last leaf is duplicated.
 */
export function buildMerkleTree(leaves: Buffer[], labels: string[]): MerkleTree {
  if (leaves.length === 0) {
    const emptyRoot = sha256('empty');
    return { root: emptyRoot, leaves: [], layers: [[emptyRoot]], labels: [] };
  }

  // Copy leaves to avoid mutation
  let currentLayer = [...leaves];

  // Pad to even number by duplicating last leaf
  if (currentLayer.length % 2 !== 0) {
    currentLayer.push(currentLayer[currentLayer.length - 1]);
  }

  const layers: Buffer[][] = [currentLayer];

  while (currentLayer.length > 1) {
    // Pad to even at every layer
    if (currentLayer.length % 2 !== 0) {
      currentLayer.push(currentLayer[currentLayer.length - 1]);
    }
    const nextLayer: Buffer[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      nextLayer.push(hashPair(currentLayer[i], currentLayer[i + 1]));
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return {
    root: currentLayer[0],
    leaves,
    layers,
    labels,
  };
}

/**
 * Generates a Merkle proof for a specific leaf by index.
 * The proof contains sibling hashes needed to recompute the root.
 */
export function getMerkleProof(tree: MerkleTree, leafIndex: number): MerkleProof {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(`Leaf index ${leafIndex} out of range (0-${tree.leaves.length - 1})`);
  }

  const proof: string[] = [];
  const directions: ('left' | 'right')[] = [];
  let index = leafIndex;

  for (let layerIdx = 0; layerIdx < tree.layers.length - 1; layerIdx++) {
    const layer = tree.layers[layerIdx];
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;

    if (siblingIndex < layer.length) {
      proof.push(layer[siblingIndex].toString('hex'));
      directions.push(index % 2 === 0 ? 'right' : 'left');
    }

    index = Math.floor(index / 2);
  }

  return {
    leaf: tree.leaves[leafIndex].toString('hex'),
    label: tree.labels[leafIndex] ?? `leaf_${leafIndex}`,
    proof,
    directions,
    root: tree.root.toString('hex'),
  };
}

/**
 * Verifies a Merkle proof: given a leaf, proof path, and root,
 * confirms the leaf is part of the tree.
 */
export function verifyMerkleProof(
  leafHex: string,
  proofHex: readonly string[],
  directions: readonly ('left' | 'right')[],
  rootHex: string
): boolean {
  let current: Buffer = Buffer.from(leafHex, 'hex') as Buffer;

  for (let i = 0; i < proofHex.length; i++) {
    const sibling: Buffer = Buffer.from(proofHex[i], 'hex') as Buffer;
    if (directions[i] === 'left') {
      current = hashPair(sibling, current);
    } else {
      current = hashPair(current, sibling);
    }
  }

  return current.toString('hex') === rootHex;
}

/**
 * Builds a Merkle tree from a policy and returns root + tree.
 */
export function buildPolicyMerkleTree(policy: Policy): MerkleTree {
  const { leaves, labels } = policyToLeaves(policy);
  return buildMerkleTree(leaves, labels);
}

/**
 * Computes the Merkle root for a policy (32 bytes).
 */
export function computePolicyMerkleRoot(policy: Policy): Buffer {
  const tree = buildPolicyMerkleTree(policy);
  return tree.root;
}

// ===== Poseidon-based policy_data_hash =======================================
// The policy_data_hash is the commitment the ZK circuit reproduces internally
// from its private policy inputs and exposes as a public output. The on-chain
// verifier compares the proof's public input against
// `PolicyAccount.policy_data_hash`, so this function MUST stay byte-for-byte
// in sync with the in-circuit hashing scheme defined in payment.circom.
//
// Hashing scheme (canonical, deterministic):
//   addrField(addr32)   = Poseidon([high16, low16])         // 1 field per pubkey
//   catField(cat≤32)    = Poseidon([high16, low16])         // 1 field per category
//   listField(items[N]) = Poseidon(items_padded_to_N_with_0s) // 1 field per list
//   timeField(restr)    = Poseidon([active, days_bitmask, start_hour_utc, end_hour_utc])
//   policy_data_hash    = Poseidon([
//                            max_daily, max_per_tx,
//                            operator_field, policy_id_field,
//                            categories_list, blocked_list, tokens_list,
//                            time_field
//                         ])
// Field order is part of the protocol — reordering invalidates every existing
// on-chain registration.

const DAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

function splitPubkey32ToFields(buf: Buffer): [bigint, bigint] {
  if (buf.length !== 32) {
    throw new Error(`splitPubkey32ToFields: expected 32-byte buffer, got ${buf.length}`);
  }
  const high = BigInt('0x' + buf.subarray(0, 16).toString('hex'));
  const low = BigInt('0x' + buf.subarray(16, 32).toString('hex'));
  return [high, low];
}

async function hashSolanaAddressField(
  poseidon: Poseidon,
  base58: string,
): Promise<bigint> {
  const raw = Buffer.from(bs58.decode(base58));
  if (raw.length !== 32) {
    throw new Error(
      `hashSolanaAddressField: address must decode to 32 bytes, got ${raw.length}: ${base58}`,
    );
  }
  const [high, low] = splitPubkey32ToFields(raw);
  return poseidonHashAsBigInt(poseidon, [high, low]);
}

async function hashCategoryField(
  poseidon: Poseidon,
  category: string,
): Promise<bigint> {
  const utf8 = Buffer.from(category, 'utf8');
  if (utf8.length > 32) {
    throw new Error(`hashCategoryField: category exceeds 32 bytes: ${category}`);
  }
  const padded = Buffer.alloc(32);
  utf8.copy(padded, 0);
  const [high, low] = splitPubkey32ToFields(padded);
  return poseidonHashAsBigInt(poseidon, [high, low]);
}

async function hashListField(
  poseidon: Poseidon,
  items: bigint[],
  maxLength: number,
): Promise<bigint> {
  if (items.length > maxLength) {
    throw new Error(
      `hashListField: list of size ${items.length} exceeds circuit max ${maxLength}`,
    );
  }
  const padded: bigint[] = [...items];
  while (padded.length < maxLength) padded.push(0n);
  return poseidonHashAsBigInt(poseidon, padded);
}

/**
 * Folds the operator_id (a base58 Solana pubkey) into a single field so it
 * lines up with how the circuit consumes it.
 */
async function hashOperatorIdField(
  poseidon: Poseidon,
  operatorId: string,
): Promise<bigint> {
  return hashSolanaAddressField(poseidon, operatorId);
}

/**
 * Folds the policy_id (a UUID v4 string) into a single field by interpreting
 * it as a 16-byte raw buffer, padded out to 32 bytes, then split into two
 * 16-byte halves and Poseidon-hashed. Same UUID -> same field, deterministic.
 */
async function hashPolicyIdField(
  poseidon: Poseidon,
  policyIdUuid: string,
): Promise<bigint> {
  const cleaned = policyIdUuid.replace(/-/g, '');
  if (cleaned.length !== 32 || !/^[0-9a-f]+$/i.test(cleaned)) {
    throw new Error(`hashPolicyIdField: invalid UUID hex: ${policyIdUuid}`);
  }
  const raw16 = Buffer.from(cleaned, 'hex'); // 16 bytes
  const padded = Buffer.alloc(32);
  raw16.copy(padded, 0); // high half = raw, low half = zeros
  const [high, low] = splitPubkey32ToFields(padded);
  return poseidonHashAsBigInt(poseidon, [high, low]);
}

/**
 * Reduces all time_restrictions into a single field. The MVP supports a
 * single window in UTC; multi-window or DST-aware semantics are handled in
 * Adım 4b alongside the circuit. An empty restriction list hashes to 0,
 * which the circuit interprets as "no time restriction enforced".
 */
async function hashTimeRestrictionsField(
  poseidon: Poseidon,
  restrictions: readonly TimeRestriction[],
): Promise<bigint> {
  if (restrictions.length === 0) {
    return 0n;
  }
  const r = restrictions[0];
  if (r.timezone !== 'UTC') {
    // The MVP commitment only handles UTC. When the dashboard offers another
    // timezone, fail loudly so we never silently sign a hash the verifier
    // cannot reproduce.
    throw new Error(
      `hashTimeRestrictionsField: only timezone='UTC' supported in MVP, got '${r.timezone}'`,
    );
  }
  let daysBitmask = 0;
  for (const day of r.allowed_days) {
    const idx = DAY_INDEX[day.toLowerCase()];
    if (idx === undefined) {
      throw new Error(`hashTimeRestrictionsField: unknown day '${day}'`);
    }
    daysBitmask |= 1 << idx;
  }
  if (
    r.allowed_hours_start < 0 || r.allowed_hours_start > 23 ||
    r.allowed_hours_end < 0 || r.allowed_hours_end > 23
  ) {
    throw new Error('hashTimeRestrictionsField: hours must be 0..23');
  }
  return poseidonHashAsBigInt(poseidon, [
    1n, // active flag
    BigInt(daysBitmask),
    BigInt(r.allowed_hours_start),
    BigInt(r.allowed_hours_end),
  ]);
}

/**
 * Computes the Poseidon-based policy_data_hash that the ZK circuit will
 * reproduce internally and the on-chain verifier will compare against
 * PolicyAccount.policy_data_hash.
 *
 * Returns a 64-char lowercase hex string (32 bytes big-endian) — the same
 * representation we already use for merkle_root_hex.
 *
 * Async because circomlibjs builds Poseidon constants on first use; cached
 * after that.
 */
export async function computePolicyDataHash(policy: Policy): Promise<string> {
  const LAMPORTS_PER_UNIT = 1_000_000;
  const dailyLamports = BigInt(
    Math.round(policy.max_daily_spend * LAMPORTS_PER_UNIT),
  );
  const perTxLamports = BigInt(
    Math.round(policy.max_per_transaction * LAMPORTS_PER_UNIT),
  );

  const poseidon = await getPoseidon();

  const operatorField = await hashOperatorIdField(poseidon, policy.operator_id);
  const policyIdField = await hashPolicyIdField(poseidon, policy.id);

  const sortedCategories = [...policy.allowed_endpoint_categories].sort();
  const categoryFields = await Promise.all(
    sortedCategories.map((c) => hashCategoryField(poseidon, c)),
  );
  const categoriesList = await hashListField(poseidon, categoryFields, MAX_CATEGORIES);

  const sortedBlocked = [...policy.blocked_addresses].sort();
  const blockedFields = await Promise.all(
    sortedBlocked.map((a) => hashSolanaAddressField(poseidon, a)),
  );
  const blockedList = await hashListField(poseidon, blockedFields, MAX_BLOCKED);

  const sortedTokens = [...policy.token_whitelist].sort();
  const tokenFields = await Promise.all(
    sortedTokens.map((a) => hashSolanaAddressField(poseidon, a)),
  );
  const tokensList = await hashListField(poseidon, tokenFields, MAX_WHITELIST);

  const timeField = await hashTimeRestrictionsField(
    poseidon,
    policy.time_restrictions,
  );

  return poseidonHashToHex(poseidon, [
    dailyLamports,
    perTxLamports,
    operatorField,
    policyIdField,
    categoriesList,
    blockedList,
    tokensList,
    timeField,
  ]);
}

export interface PolicyOnChainCommitments {
  readonly merkleRootHex: string;
  readonly policyDataHashHex: string;
}

/**
 * Returns both commitments in one call so callers do not build two separate
 * hashing pipelines and accidentally drift apart. merkle_root_hex is still
 * SHA-256 (selective disclosure / off-chain auditor); policy_data_hash_hex
 * is now Poseidon (ZK circuit ↔ on-chain verifier binding).
 */
export async function computePolicyCommitments(
  policy: Policy,
): Promise<PolicyOnChainCommitments> {
  return {
    merkleRootHex: computePolicyMerkleRoot(policy).toString('hex'),
    policyDataHashHex: await computePolicyDataHash(policy),
  };
}
