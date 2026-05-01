/**
 * Anchor program instruction builders for Aperture on-chain programs.
 * Replaces all Memo program usage with real CPI calls.
 */
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Ed25519Program,
  type Connection,
} from '@solana/web3.js';
import { config } from './config';

const POLICY_REGISTRY_PROGRAM = new PublicKey(config.programs.policyRegistry);
const VERIFIER_PROGRAM = new PublicKey(config.programs.verifier);

// Sysvar Instructions program ID — exposes the current transaction's
// instruction list to programs that need to introspect prior ix's, e.g. the
// MPP verifier reading the preceding ed25519 verify instruction.
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey(
  'Sysvar1nstructions1111111111111111111111111',
);

// -- Anchor discriminators (first 8 bytes of SHA-256("global:<method_name>")) --

const DISCRIMINATORS = {
  initializeOperator: Buffer.from([155, 33, 216, 254, 233, 227, 175, 212]),
  registerPolicy: Buffer.from([62, 66, 167, 36, 252, 227, 38, 132]),
  updatePolicy: Buffer.from([212, 245, 246, 7, 163, 151, 18, 57]),
  verifyPaymentProof: Buffer.from([247, 147, 241, 26, 26, 113, 39, 66]),
  verifyPaymentProofV2: Buffer.from([15, 218, 30, 217, 205, 0, 219, 86]),
  verifyPaymentProofV2WithTransfer: Buffer.from([135, 175, 216, 175, 66, 118, 196, 204]),
  verifyMppPaymentProof: Buffer.from([91, 1, 37, 88, 220, 232, 8, 48]),
  verifyBatchAttestation: Buffer.from([85, 129, 17, 164, 94, 99, 86, 45]),
} as const;

// SPL Token program IDs the verify_payment_proof_v2_with_transfer ix
// accepts. Token-1 is the legacy program used by Circle USDC, USDT, and
// most stablecoins; Token-2022 is the extension-aware program used by
// Aperture's own aUSDC mint with a transfer-hook.
const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

// -- Helpers --

function hexToBytes32(hex: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16) || 0;
  }
  return bytes;
}

function stringToBytes32(str: string): Uint8Array {
  const hash = new Uint8Array(32);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  hash.set(encoded.slice(0, 32));
  return hash;
}

async function sha256Bytes(data: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(hashBuffer);
}

function writeU32LE(buf: Buffer, value: number, offset: number): void {
  buf.writeUInt32LE(value, offset);
}

function writeI64LE(buf: Buffer, value: bigint, offset: number): void {
  buf.writeBigInt64LE(value, offset);
}

function writeBorshVec(data: Uint8Array): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(data.length, 0);
  return Buffer.concat([lenBuf, Buffer.from(data)]);
}

// -- PDA Derivations --

export function deriveOperatorPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    POLICY_REGISTRY_PROGRAM
  );
}

export function derivePolicyPDA(
  operatorAccount: PublicKey,
  policyId: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorAccount.toBuffer(), policyId],
    POLICY_REGISTRY_PROGRAM
  );
}

export function deriveProofRecordPDA(
  operator: PublicKey,
  proofHash: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), operator.toBuffer(), proofHash],
    VERIFIER_PROGRAM
  );
}

export function deriveAttestationRecordPDA(
  operator: PublicKey,
  batchHash: Uint8Array
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), operator.toBuffer(), batchHash],
    VERIFIER_PROGRAM
  );
}

// -- Policy Registry Instructions --

export function buildInitializeOperatorIx(
  authority: PublicKey,
  operatorName: string
): TransactionInstruction {
  const [operatorAccount] = deriveOperatorPDA(authority);

  // Borsh serialize: discriminator + string (len + bytes)
  const nameBytes = Buffer.from(operatorName, 'utf-8');
  const data = Buffer.alloc(8 + 4 + nameBytes.length);
  DISCRIMINATORS.initializeOperator.copy(data, 0);
  data.writeUInt32LE(nameBytes.length, 8);
  nameBytes.copy(data, 12);

  return new TransactionInstruction({
    programId: POLICY_REGISTRY_PROGRAM,
    keys: [
      { pubkey: operatorAccount, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function hexToBuffer32(hex: string): Buffer {
  if (hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(`Expected 64 hex chars (32 bytes), got ${hex.length}: ${hex.slice(0, 16)}…`);
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Builds the policy-registry register_policy instruction. The caller MUST
 * pass the merkle_root_hex / policy_data_hash_hex / policy_id_bytes_hex
 * exactly as they came back from GET /api/v1/policies/:id/onchain-payload —
 * the policy-service is the single source of truth for those commitments.
 *
 * Recomputing them on the client is forbidden because the leaf serialization
 * and canonical sort rules live in the policy-service utils/merkle.ts, and
 * the verifier later cross-checks the on-chain merkle_root against those
 * exact bytes.
 */
export function buildRegisterPolicyIx(
  authority: PublicKey,
  policyIdBytesHex: string,
  merkleRootHex: string,
  policyDataHashHex: string,
): { instruction: TransactionInstruction; policyPDA: PublicKey } {
  const policyIdBytes = hexToBuffer32(policyIdBytesHex);
  const merkleRoot = hexToBuffer32(merkleRootHex);
  const policyDataHash = hexToBuffer32(policyDataHashHex);

  const [operatorAccount] = deriveOperatorPDA(authority);
  const [policyPDA] = derivePolicyPDA(operatorAccount, policyIdBytes);

  // Borsh serialize: discriminator + policy_id[32] + merkle_root[32] + policy_data_hash[32]
  const data = Buffer.alloc(8 + 32 + 32 + 32);
  DISCRIMINATORS.registerPolicy.copy(data, 0);
  policyIdBytes.copy(data, 8);
  merkleRoot.copy(data, 40);
  policyDataHash.copy(data, 72);

  const instruction = new TransactionInstruction({
    programId: POLICY_REGISTRY_PROGRAM,
    keys: [
      { pubkey: policyPDA, isSigner: false, isWritable: true },
      { pubkey: operatorAccount, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return { instruction, policyPDA };
}

/**
 * Builds the policy-registry update_policy instruction. Same contract as
 * buildRegisterPolicyIx — the caller passes server-pinned hex commitments.
 * Use derivePolicyPDA(operatorAccount, hexToBuffer32(policyIdBytesHex)) to
 * resolve policyPDA before calling this.
 */
export function buildUpdatePolicyIx(
  authority: PublicKey,
  operatorAccount: PublicKey,
  policyPDA: PublicKey,
  merkleRootHex: string,
  policyDataHashHex: string,
): TransactionInstruction {
  const newMerkleRoot = hexToBuffer32(merkleRootHex);
  const newPolicyDataHash = hexToBuffer32(policyDataHashHex);

  // Borsh serialize: discriminator + new_merkle_root[32] + new_policy_data_hash[32]
  const data = Buffer.alloc(8 + 32 + 32);
  DISCRIMINATORS.updatePolicy.copy(data, 0);
  newMerkleRoot.copy(data, 8);
  newPolicyDataHash.copy(data, 40);

  return new TransactionInstruction({
    programId: POLICY_REGISTRY_PROGRAM,
    keys: [
      { pubkey: policyPDA, isSigner: false, isWritable: true },
      { pubkey: operatorAccount, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// -- Verifier Instructions --

export function deriveComplianceStatusPDA(
  operator: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('compliance'), operator.toBuffer()],
    VERIFIER_PROGRAM
  );
}

export function deriveOperatorStatePDA(
  operator: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator_state'), operator.toBuffer()],
    VERIFIER_PROGRAM
  );
}

/**
 * Decoded view of the verifier program's OperatorState account. The dashboard
 * and the agent SDK call readOperatorState() to source the daily-spent value
 * that will eventually become a public input to the compliance circuit; the
 * old in-memory tracker that reset on agent restart is gone.
 */
export interface OperatorStateView {
  readonly operator: PublicKey;
  readonly dailySpentLamports: bigint;
  readonly dayStartUnix: bigint;
  readonly totalLifetimePayments: bigint;
  readonly bump: number;
}

const OPERATOR_STATE_DISCRIMINATOR = Buffer.from([
  // SHA-256("account:OperatorState").slice(0, 8). Anchor derives this at
  // compile time; pin the bytes here so the dashboard does not need the
  // generated IDL to deserialize an account.
  253, 164, 195, 158, 226, 13, 170, 145,
]);

function readU64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

function readI64LE(buf: Buffer, offset: number): bigint {
  return buf.readBigInt64LE(offset);
}

/**
 * Deserializes an OperatorState account fetched via connection.getAccountInfo.
 * Returns null when the account does not exist (operator never paid yet) so
 * callers can treat that as a clean zero-spent state without a try/catch.
 *
 * The account layout MUST stay in sync with
 * programs/verifier/src/state/operator_state.rs — any field reordering there
 * is a wire-format change that breaks every dashboard build.
 *
 * Layout (after the 8-byte Anchor discriminator):
 *   pub operator: Pubkey                 // 32 bytes
 *   pub daily_spent_lamports: u64        //  8 bytes LE
 *   pub day_start_unix: i64              //  8 bytes LE
 *   pub total_lifetime_payments: u64     //  8 bytes LE
 *   pub bump: u8                         //  1 byte
 * Total: 8 + 32 + 8 + 8 + 8 + 1 = 65 bytes
 */
export function decodeOperatorState(data: Buffer | Uint8Array): OperatorStateView {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 65) {
    throw new Error(`OperatorState too short: ${buf.length} bytes (need 65)`);
  }
  if (buf.compare(OPERATOR_STATE_DISCRIMINATOR, 0, 8, 0, 8) !== 0) {
    throw new Error('OperatorState discriminator mismatch — wrong account?');
  }
  return {
    operator: new PublicKey(buf.subarray(8, 8 + 32)),
    dailySpentLamports: readU64LE(buf, 40),
    dayStartUnix: readI64LE(buf, 48),
    totalLifetimePayments: readU64LE(buf, 56),
    bump: buf.readUInt8(64),
  };
}

/**
 * Builds the verifier's initialize_operator_state instruction. Optional one-time
 * setup the dashboard can offer in the Settings tab; otherwise the
 * record_payment instruction (Adım 6) creates the PDA on first use via
 * init_if_needed.
 */
const INITIALIZE_OPERATOR_STATE_DISC = Buffer.from([
  // SHA-256("global:initialize_operator_state").slice(0, 8) — the same bytes
  // Anchor would generate when invoking this method via the IDL.
  151, 141, 122, 89, 143, 223, 124, 228,
]);

/**
 * Fetches the OperatorState PDA for the given operator and returns a decoded
 * view. When the PDA does not exist yet — the operator has never paid and
 * never explicitly initialized — the function returns null so callers can
 * treat the spend as zero without a special-case try/catch.
 */
export async function readOperatorState(
  connection: Connection,
  operator: PublicKey,
): Promise<OperatorStateView | null> {
  const [operatorStatePDA] = deriveOperatorStatePDA(operator);
  const accountInfo = await connection.getAccountInfo(operatorStatePDA);
  if (!accountInfo) return null;
  return decodeOperatorState(accountInfo.data);
}

/**
 * Returns the daily-spent value the circuit should consume as
 * `daily_spent_before` (Adım 4 public input). Encapsulates the rolling-day
 * rule: if the on-chain `day_start_unix` is older than today's UTC midnight,
 * the effective daily spend is 0 — the next record_payment will reset it
 * atomically on-chain, and we mirror that view client-side so the circuit
 * input matches what the verifier will compute.
 */
export async function readEffectiveDailySpentLamports(
  connection: Connection,
  operator: PublicKey,
): Promise<bigint> {
  const state = await readOperatorState(connection, operator);
  if (!state) return 0n;
  const SECONDS_PER_DAY = 86_400n;
  const todayStart =
    BigInt(Math.floor(Date.now() / 1000)) -
    (BigInt(Math.floor(Date.now() / 1000)) % SECONDS_PER_DAY);
  return todayStart > state.dayStartUnix ? 0n : state.dailySpentLamports;
}

export function buildInitializeOperatorStateIx(
  operator: PublicKey,
  payer: PublicKey,
): TransactionInstruction {
  const [operatorStatePDA] = deriveOperatorStatePDA(operator);

  const data = Buffer.alloc(8);
  INITIALIZE_OPERATOR_STATE_DISC.copy(data, 0);

  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys: [
      { pubkey: operatorStatePDA, isSigner: false, isWritable: true },
      { pubkey: operator, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function buildVerifyPaymentProofIx(
  operator: PublicKey,
  payer: PublicKey,
  policyAccountKey: PublicKey,
  proofHashBytes: Uint8Array,
  imageId: number[],
  journalDigestBytes: Uint8Array,
  receiptData: Uint8Array
): TransactionInstruction {
  const [proofRecordPDA] = deriveProofRecordPDA(operator, proofHashBytes);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(operator);

  // Borsh serialize:
  // discriminator[8] + proof_hash[32] + image_id[32] (8 x u32) + journal_digest[32] + receipt_data (borsh Vec<u8>)
  const receiptVec = writeBorshVec(receiptData);
  const data = Buffer.alloc(8 + 32 + 32 + 32 + receiptVec.length);
  let offset = 0;

  DISCRIMINATORS.verifyPaymentProof.copy(data, offset);
  offset += 8;

  Buffer.from(proofHashBytes).copy(data, offset);
  offset += 32;

  // image_id: [u32; 8] - 8 little-endian u32s
  for (let i = 0; i < 8; i++) {
    writeU32LE(data, imageId[i] ?? 0, offset);
    offset += 4;
  }

  Buffer.from(journalDigestBytes).copy(data, offset);
  offset += 32;

  receiptVec.copy(data, offset);

  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys: [
      { pubkey: proofRecordPDA, isSigner: false, isWritable: true },
      { pubkey: complianceStatusPDA, isSigner: false, isWritable: true },
      { pubkey: policyAccountKey, isSigner: false, isWritable: false },
      { pubkey: operator, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// v2: Circom Groth16 verification. Pairs with the prover-service endpoint
// POST /prove — that response's `groth16` block (proof_a, proof_b, proof_c,
// public_inputs as base64) is decoded on the caller side and fed here.
//
// The 10 public inputs (Adım 4b + 8b) are, in order:
//   [0] is_compliant
//   [1] policy_data_hash       (PDA seed for proof_record)
//   [2] recipient_high
//   [3] recipient_low
//   [4] amount_lamports
//   [5] token_mint_high
//   [6] token_mint_low
//   [7] daily_spent_before
//   [8] current_unix_timestamp
//   [9] stripe_receipt_hash     (zero for Solana flow, non-zero for MPP B-flow)
//
// The proof_record PDA is seeded by policy_data_hash (public_inputs[1])
// because that commitment is unique per (policy, payment) combination and
// gives the verifier a cheap O(1) lookup.
export const PAYMENT_NR_INPUTS = 10;

function encodeVerifyIxData(
  discriminator: Buffer,
  proofA: Uint8Array,
  proofB: Uint8Array,
  proofC: Uint8Array,
  publicInputs: ReadonlyArray<Uint8Array>,
): Buffer {
  if (proofA.length !== 64) throw new Error('proof_a must be 64 bytes');
  if (proofB.length !== 128) throw new Error('proof_b must be 128 bytes');
  if (proofC.length !== 64) throw new Error('proof_c must be 64 bytes');
  if (publicInputs.length !== PAYMENT_NR_INPUTS) {
    throw new Error(
      `public_inputs must have exactly ${PAYMENT_NR_INPUTS} entries (got ${publicInputs.length})`,
    );
  }
  for (let i = 0; i < publicInputs.length; i++) {
    if (publicInputs[i].length !== 32) {
      throw new Error(`public_inputs[${i}] must be 32 bytes`);
    }
  }
  // Layout: disc[8] + proof_a[64] + proof_b[128] + proof_c[64] + 10 * 32
  const data = Buffer.alloc(8 + 64 + 128 + 64 + PAYMENT_NR_INPUTS * 32);
  let offset = 0;
  discriminator.copy(data, offset);
  offset += 8;
  Buffer.from(proofA).copy(data, offset);
  offset += 64;
  Buffer.from(proofB).copy(data, offset);
  offset += 128;
  Buffer.from(proofC).copy(data, offset);
  offset += 64;
  for (const input of publicInputs) {
    Buffer.from(input).copy(data, offset);
    offset += 32;
  }
  return data;
}

/**
 * Builds the verifier's verify_payment_proof_v2 instruction.
 *
 * Account order MUST match VerifyPaymentProofV2's #[derive(Accounts)] in
 * programs/verifier/src/instructions/verify_payment_v2.rs:
 *   0: proof_record       (mut, init_if_needed)
 *   1: compliance_status  (mut, init_if_needed)
 *   2: operator_state     (mut, init_if_needed)
 *   3: policy_account     (read, owned by policy-registry)
 *   4: operator_account   (read, owned by policy-registry — the OperatorPDA)
 *   5: operator           (signer)
 *   6: payer              (signer, mut)
 *   7: system_program
 */
export function buildVerifyPaymentProofV2Ix(
  operator: PublicKey,
  payer: PublicKey,
  policyAccountKey: PublicKey,
  proofA: Uint8Array,
  proofB: Uint8Array,
  proofC: Uint8Array,
  publicInputs: Uint8Array[]
): TransactionInstruction {
  // public_inputs[1] = policy_data_hash (Poseidon commitment over policy fields)
  const policyDataHash = publicInputs[1];
  const [proofRecordPDA] = deriveProofRecordPDA(operator, policyDataHash);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(operator);
  const [operatorStatePDA] = deriveOperatorStatePDA(operator);
  const [operatorAccountPDA] = deriveOperatorPDA(operator);

  const data = encodeVerifyIxData(
    DISCRIMINATORS.verifyPaymentProofV2,
    proofA,
    proofB,
    proofC,
    publicInputs,
  );

  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys: [
      { pubkey: proofRecordPDA, isSigner: false, isWritable: true },
      { pubkey: complianceStatusPDA, isSigner: false, isWritable: true },
      { pubkey: operatorStatePDA, isSigner: false, isWritable: true },
      { pubkey: policyAccountKey, isSigner: false, isWritable: false },
      { pubkey: operatorAccountPDA, isSigner: false, isWritable: false },
      { pubkey: operator, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds the verifier's verify_mpp_payment_proof instruction. The caller
 * MUST place the matching Solana Ed25519Program verify instruction at index
 * 0 of the same transaction; this Anchor instruction reads it via the
 * Sysvar Instructions account to authenticate the Stripe receipt hash.
 *
 * Account order MUST match VerifyMppPaymentProof's #[derive(Accounts)] in
 * programs/verifier/src/instructions/verify_mpp_payment_proof.rs:
 *   0: proof_record           (mut, init_if_needed)
 *   1: compliance_status      (mut, init_if_needed)
 *   2: operator_state         (mut, init_if_needed)
 *   3: policy_account         (read, owned by policy-registry)
 *   4: operator_account       (read, owned by policy-registry)
 *   5: operator               (signer)
 *   6: payer                  (signer, mut)
 *   7: instructions_sysvar    (read; the verifier loads ix index 0 from this)
 *   8: system_program
 */
export function buildVerifyMppPaymentProofIx(
  operator: PublicKey,
  payer: PublicKey,
  policyAccountKey: PublicKey,
  proofA: Uint8Array,
  proofB: Uint8Array,
  proofC: Uint8Array,
  publicInputs: Uint8Array[],
): TransactionInstruction {
  const policyDataHash = publicInputs[1];
  const [proofRecordPDA] = deriveProofRecordPDA(operator, policyDataHash);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(operator);
  const [operatorStatePDA] = deriveOperatorStatePDA(operator);
  const [operatorAccountPDA] = deriveOperatorPDA(operator);

  const data = encodeVerifyIxData(
    DISCRIMINATORS.verifyMppPaymentProof,
    proofA,
    proofB,
    proofC,
    publicInputs,
  );

  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys: [
      { pubkey: proofRecordPDA, isSigner: false, isWritable: true },
      { pubkey: complianceStatusPDA, isSigner: false, isWritable: true },
      { pubkey: operatorStatePDA, isSigner: false, isWritable: true },
      { pubkey: policyAccountKey, isSigner: false, isWritable: false },
      { pubkey: operatorAccountPDA, isSigner: false, isWritable: false },
      { pubkey: operator, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds the Solana Ed25519Program native instruction that authenticates a
 * Stripe receipt hash. The on-chain MPP verifier reads this exact instruction
 * off the Sysvar Instructions account at index 0 of the same transaction,
 * parses signer/message/signature, and rejects anything that does not match
 * the proof's stripe_receipt_hash and the configured MPP_AUTHORITY pubkey.
 */
export function buildEd25519VerifyIx(
  authorityPubkey: PublicKey,
  signatureBytes: Uint8Array,
  messageBytes: Uint8Array,
): TransactionInstruction {
  if (signatureBytes.length !== 64) {
    throw new Error('signature must be 64 bytes');
  }
  if (messageBytes.length !== 32) {
    throw new Error('message must be exactly 32 bytes (the receipt hash)');
  }
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: authorityPubkey.toBytes(),
    message: messageBytes,
    signature: signatureBytes,
  });
}

export function buildVerifyBatchAttestationIx(
  operator: PublicKey,
  payer: PublicKey,
  batchHashBytes: Uint8Array,
  imageId: number[],
  journalDigestBytes: Uint8Array,
  totalPayments: number,
  periodStart: bigint,
  periodEnd: bigint,
  receiptData: Uint8Array
): TransactionInstruction {
  const [attestationRecordPDA] = deriveAttestationRecordPDA(
    operator,
    batchHashBytes
  );

  // Borsh serialize:
  // disc[8] + batch_hash[32] + image_id[32] + journal_digest[32] + total_payments u32[4]
  // + period_start i64[8] + period_end i64[8] + receipt_data Vec<u8>
  const receiptVec = writeBorshVec(receiptData);
  const data = Buffer.alloc(8 + 32 + 32 + 32 + 4 + 8 + 8 + receiptVec.length);
  let offset = 0;

  DISCRIMINATORS.verifyBatchAttestation.copy(data, offset);
  offset += 8;

  Buffer.from(batchHashBytes).copy(data, offset);
  offset += 32;

  for (let i = 0; i < 8; i++) {
    writeU32LE(data, imageId[i] ?? 0, offset);
    offset += 4;
  }

  Buffer.from(journalDigestBytes).copy(data, offset);
  offset += 32;

  writeU32LE(data, totalPayments, offset);
  offset += 4;

  writeI64LE(data, periodStart, offset);
  offset += 8;

  writeI64LE(data, periodEnd, offset);
  offset += 8;

  receiptVec.copy(data, offset);

  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys: [
      { pubkey: attestationRecordPDA, isSigner: false, isWritable: true },
      { pubkey: operator, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds the verifier's verify_payment_proof_v2_with_transfer instruction.
 * Single atomic ix that runs the Groth16 verification, byte-binds
 * recipient/mint/amount to the actual transfer, updates OperatorState +
 * ProofRecord, and CPIs the appropriate token program's transferChecked.
 *
 * Account order MUST match VerifyPaymentProofV2WithTransfer in
 * programs/verifier/src/instructions/verify_payment_v2_with_transfer.rs:
 *   0: proof_record               (mut, init_if_needed)
 *   1: compliance_status          (mut, init_if_needed)
 *   2: operator_state             (mut, init_if_needed)
 *   3: policy_account             (read, owned by policy-registry)
 *   4: operator_account           (read, owned by policy-registry)
 *   5: operator                   (signer)
 *   6: payer                      (signer, mut)
 *   7: source_token_account       (mut)
 *   8: destination_token_account  (mut)
 *   9: mint                       (read)
 *  10: token_program              (Token-1 or Token-2022)
 *  11: system_program
 */
export function buildVerifyPaymentProofV2WithTransferIx(args: {
  operator: PublicKey;
  payer: PublicKey;
  policyAccount: PublicKey;
  operatorAccount: PublicKey;
  sourceTokenAccount: PublicKey;
  destinationTokenAccount: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  proofA: Uint8Array;
  proofB: Uint8Array;
  proofC: Uint8Array;
  publicInputs: Uint8Array[];
  transferAmount: bigint;
}): TransactionInstruction {
  if (args.proofA.length !== 64) throw new Error('proof_a must be 64 bytes');
  if (args.proofB.length !== 128) throw new Error('proof_b must be 128 bytes');
  if (args.proofC.length !== 64) throw new Error('proof_c must be 64 bytes');
  if (args.publicInputs.length !== PAYMENT_NR_INPUTS) {
    throw new Error(`public_inputs must have exactly ${PAYMENT_NR_INPUTS} entries`);
  }
  if (
    !args.tokenProgram.equals(TOKEN_PROGRAM_ID) &&
    !args.tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error(`token_program must be SPL Token or Token-2022 (got ${args.tokenProgram.toBase58()})`);
  }
  for (let i = 0; i < args.publicInputs.length; i++) {
    if (args.publicInputs[i].length !== 32) {
      throw new Error(`public_inputs[${i}] must be 32 bytes`);
    }
  }

  const policyDataHash = args.publicInputs[1];
  const [proofRecordPDA] = deriveProofRecordPDA(args.operator, policyDataHash);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(args.operator);
  const [operatorStatePDA] = deriveOperatorStatePDA(args.operator);

  const data = Buffer.alloc(8 + 64 + 128 + 64 + PAYMENT_NR_INPUTS * 32 + 8);
  let offset = 0;
  DISCRIMINATORS.verifyPaymentProofV2WithTransfer.copy(data, offset);
  offset += 8;
  Buffer.from(args.proofA).copy(data, offset);
  offset += 64;
  Buffer.from(args.proofB).copy(data, offset);
  offset += 128;
  Buffer.from(args.proofC).copy(data, offset);
  offset += 64;
  for (const pi of args.publicInputs) {
    Buffer.from(pi).copy(data, offset);
    offset += 32;
  }
  data.writeBigUInt64LE(args.transferAmount, offset);

  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys: [
      { pubkey: proofRecordPDA, isSigner: false, isWritable: true },
      { pubkey: complianceStatusPDA, isSigner: false, isWritable: true },
      { pubkey: operatorStatePDA, isSigner: false, isWritable: true },
      { pubkey: args.policyAccount, isSigner: false, isWritable: false },
      { pubkey: args.operatorAccount, isSigner: false, isWritable: false },
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.sourceTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.destinationTokenAccount, isSigner: false, isWritable: true },
      { pubkey: args.mint, isSigner: false, isWritable: false },
      { pubkey: args.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// -- Utility exports --

export { hexToBytes32, stringToBytes32, sha256Bytes };
