import { createHash } from 'node:crypto';
import type { Policy } from '@aperture/types';

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
