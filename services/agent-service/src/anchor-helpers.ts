// Anchor instruction builders + PDA derivations the agent-service needs to
// drive the new on-chain payment flow:
//
//   1. verify_payment_proof_v2 — anchors the ZK proof + sets the operator's
//      pending_proof_hash (Adım 5).
//   2. SPL Token-2022 transferCheckedWithTransferHook — the transfer-hook
//      consumes the pending proof + bumps daily_spent via record_payment CPI
//      (Adım 6).
//
// All discriminators are pinned to the SHA-256 outputs we computed at the
// time the corresponding Rust handler was written. Anything that drifts here
// fails closed against the on-chain Anchor account constraint, so a typo
// surfaces immediately as an InstructionFallbackNotFound, not silent payload
// corruption.

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  Ed25519Program,
  type Connection,
} from '@solana/web3.js';

export const VERIFIER_PROGRAM = new PublicKey(
  process.env.VERIFIER_PROGRAM ?? 'AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU',
);
export const POLICY_REGISTRY_PROGRAM = new PublicKey(
  process.env.POLICY_REGISTRY_PROGRAM ?? 'FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU',
);

const DISC_VERIFY_PAYMENT_PROOF_V2 = Buffer.from([
  15, 218, 30, 217, 205, 0, 219, 86,
]);

const DISC_VERIFY_MPP_PAYMENT_PROOF = Buffer.from([
  91, 1, 37, 88, 220, 232, 8, 48,
]);

// Sysvar Instructions program ID — exposes the current transaction's
// instruction list to programs that need to introspect prior ix's, e.g. the
// MPP verifier reading the preceding ed25519 verify instruction.
const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey('Sysvar1nstructions1111111111111111111111111');

export const PAYMENT_NR_INPUTS = 10;

export function deriveOperatorPDA(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    POLICY_REGISTRY_PROGRAM,
  );
}

export function derivePolicyPDA(
  operatorAccount: PublicKey,
  policyIdBytes: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorAccount.toBuffer(), Buffer.from(policyIdBytes)],
    POLICY_REGISTRY_PROGRAM,
  );
}

export function deriveProofRecordPDA(
  operator: PublicKey,
  policyDataHash: Uint8Array,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), operator.toBuffer(), Buffer.from(policyDataHash)],
    VERIFIER_PROGRAM,
  );
}

export function deriveComplianceStatusPDA(
  operator: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('compliance'), operator.toBuffer()],
    VERIFIER_PROGRAM,
  );
}

export function deriveOperatorStatePDA(
  operator: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator_state'), operator.toBuffer()],
    VERIFIER_PROGRAM,
  );
}

/**
 * Decoded view of the verifier program's OperatorState account. Used to read
 * `daily_spent_lamports` (and `pending_proof_hash`) before generating a new
 * proof, so the circuit's public input matches what the verifier will see.
 *
 * Layout (after the 8-byte Anchor discriminator):
 *   pub operator: Pubkey                 // 32 bytes
 *   pub daily_spent_lamports: u64        //  8 bytes LE
 *   pub day_start_unix: i64              //  8 bytes LE
 *   pub total_lifetime_payments: u64     //  8 bytes LE
 *   pub pending_proof_hash: [u8; 32]     // 32 bytes
 *   pub bump: u8                         //  1 byte
 * Total: 8 + 32 + 8 + 8 + 8 + 32 + 1 = 97 bytes
 */
export interface OperatorStateView {
  readonly operator: PublicKey;
  readonly dailySpentLamports: bigint;
  readonly dayStartUnix: bigint;
  readonly totalLifetimePayments: bigint;
  readonly pendingProofHash: Buffer;
  readonly bump: number;
}

const OPERATOR_STATE_DISCRIMINATOR = Buffer.from([
  253, 164, 195, 158, 226, 13, 170, 145,
]);

export function decodeOperatorState(data: Uint8Array): OperatorStateView {
  const buf = Buffer.from(data);
  if (buf.length < 97) {
    throw new Error(`OperatorState too short: ${buf.length} bytes (need 97)`);
  }
  if (buf.compare(OPERATOR_STATE_DISCRIMINATOR, 0, 8, 0, 8) !== 0) {
    throw new Error('OperatorState discriminator mismatch — wrong account');
  }
  return {
    operator: new PublicKey(buf.subarray(8, 40)),
    dailySpentLamports: buf.readBigUInt64LE(40),
    dayStartUnix: buf.readBigInt64LE(48),
    totalLifetimePayments: buf.readBigUInt64LE(56),
    pendingProofHash: buf.subarray(64, 96),
    bump: buf.readUInt8(96),
  };
}

/**
 * Reads the OperatorState PDA for the given operator. Returns null when the
 * account does not exist yet — the agent treats that as "0 USDC spent today,
 * no pending proof", same convention the verifier itself uses on first call.
 */
export async function readOperatorState(
  connection: Connection,
  operator: PublicKey,
): Promise<OperatorStateView | null> {
  const [pda] = deriveOperatorStatePDA(operator);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return decodeOperatorState(info.data);
}

/**
 * Returns the daily-spent value the circuit must consume as
 * `daily_spent_before`. Mirrors the verifier's UTC-rollover rule so the proof's
 * public input matches what the verifier recomputes on-chain.
 */
export async function readEffectiveDailySpentLamports(
  connection: Connection,
  operator: PublicKey,
): Promise<bigint> {
  const state = await readOperatorState(connection, operator);
  if (!state) return 0n;
  const SECONDS_PER_DAY = 86_400n;
  const nowUnix = BigInt(Math.floor(Date.now() / 1000));
  const todayStart = nowUnix - (nowUnix % SECONDS_PER_DAY);
  return todayStart > state.dayStartUnix ? 0n : state.dailySpentLamports;
}

interface BuildVerifyPaymentIxArgs {
  readonly operator: PublicKey;
  readonly payer: PublicKey;
  readonly policyAccount: PublicKey;
  readonly operatorAccount: PublicKey;
  readonly proofA: Uint8Array;
  readonly proofB: Uint8Array;
  readonly proofC: Uint8Array;
  readonly publicInputs: ReadonlyArray<Uint8Array>;
}

/**
 * Builds the verifier's verify_payment_proof_v2 instruction. Mirrors the
 * dashboard's anchor-instructions.ts builder — keep them in sync.
 */
export function buildVerifyPaymentProofV2Ix(
  args: BuildVerifyPaymentIxArgs,
): TransactionInstruction {
  if (args.proofA.length !== 64) throw new Error('proof_a must be 64 bytes');
  if (args.proofB.length !== 128) throw new Error('proof_b must be 128 bytes');
  if (args.proofC.length !== 64) throw new Error('proof_c must be 64 bytes');
  if (args.publicInputs.length !== PAYMENT_NR_INPUTS) {
    throw new Error(
      `public_inputs must have exactly ${PAYMENT_NR_INPUTS} entries (got ${args.publicInputs.length})`,
    );
  }
  for (let i = 0; i < args.publicInputs.length; i++) {
    if (args.publicInputs[i].length !== 32) {
      throw new Error(`public_inputs[${i}] must be 32 bytes`);
    }
  }

  const policyDataHash = Buffer.from(args.publicInputs[1]);
  const [proofRecordPDA] = deriveProofRecordPDA(args.operator, policyDataHash);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(args.operator);
  const [operatorStatePDA] = deriveOperatorStatePDA(args.operator);

  // Layout: disc[8] + proof_a[64] + proof_b[128] + proof_c[64] + public_inputs[9 * 32]
  const data = Buffer.alloc(8 + 64 + 128 + 64 + PAYMENT_NR_INPUTS * 32);
  let offset = 0;
  DISC_VERIFY_PAYMENT_PROOF_V2.copy(data, offset);
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

  // Account order MUST match VerifyPaymentProofV2's #[derive(Accounts)] in
  // programs/verifier/src/instructions/verify_payment_v2.rs (Adım 5):
  //   0: proof_record (mut, init_if_needed)
  //   1: compliance_status (mut, init_if_needed)
  //   2: operator_state (mut, init_if_needed)
  //   3: policy_account (read, owned by policy-registry)
  //   4: operator_account (read, owned by policy-registry)
  //   5: operator (signer)
  //   6: payer (signer, mut)
  //   7: system_program
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
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

interface BuildMppVerifyIxArgs {
  readonly operator: PublicKey;
  readonly payer: PublicKey;
  readonly policyAccount: PublicKey;
  readonly operatorAccount: PublicKey;
  readonly proofA: Uint8Array;
  readonly proofB: Uint8Array;
  readonly proofC: Uint8Array;
  readonly publicInputs: ReadonlyArray<Uint8Array>;
}

/**
 * Builds the verifier's verify_mpp_payment_proof instruction. The caller
 * MUST place the matching Solana Ed25519Program verify instruction at index
 * 0 of the same transaction; this Anchor instruction reads it via the
 * Sysvar Instructions account to authenticate the Stripe receipt hash.
 *
 * Account order MUST match VerifyMppPaymentProof's #[derive(Accounts)] in
 * programs/verifier/src/instructions/verify_mpp_payment_proof.rs (Adım 8c):
 *   0: proof_record            (mut, init_if_needed)
 *   1: compliance_status       (mut, init_if_needed)
 *   2: operator_state          (mut, init_if_needed)
 *   3: policy_account          (read, owned by policy-registry)
 *   4: operator_account        (read, owned by policy-registry)
 *   5: operator                (signer)
 *   6: payer                   (signer, mut)
 *   7: instructions_sysvar     (read; the verifier loads ix index 0 from this)
 *   8: system_program
 */
export function buildVerifyMppPaymentProofIx(
  args: BuildMppVerifyIxArgs,
): TransactionInstruction {
  if (args.proofA.length !== 64) throw new Error('proof_a must be 64 bytes');
  if (args.proofB.length !== 128) throw new Error('proof_b must be 128 bytes');
  if (args.proofC.length !== 64) throw new Error('proof_c must be 64 bytes');
  if (args.publicInputs.length !== PAYMENT_NR_INPUTS) {
    throw new Error(
      `public_inputs must have exactly ${PAYMENT_NR_INPUTS} entries (got ${args.publicInputs.length})`,
    );
  }
  for (let i = 0; i < args.publicInputs.length; i++) {
    if (args.publicInputs[i].length !== 32) {
      throw new Error(`public_inputs[${i}] must be 32 bytes`);
    }
  }

  const policyDataHash = Buffer.from(args.publicInputs[1]);
  const [proofRecordPDA] = deriveProofRecordPDA(args.operator, policyDataHash);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(args.operator);
  const [operatorStatePDA] = deriveOperatorStatePDA(args.operator);

  const data = Buffer.alloc(8 + 64 + 128 + 64 + PAYMENT_NR_INPUTS * 32);
  let offset = 0;
  DISC_VERIFY_MPP_PAYMENT_PROOF.copy(data, offset);
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
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/// SPL Token-2022 program ID — used as the explicit token_program account
/// for the verify+transfer atomic ix.
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

/// Anchor discriminator for verify_payment_proof_v2_with_transfer (the
/// new atomic verify+transfer ix added to the verifier program in Adım 9).
const DISC_VERIFY_PAYMENT_V2_WITH_TRANSFER = Buffer.from([
  135, 175, 216, 175, 66, 118, 196, 204,
]);

interface BuildVerifyWithTransferIxArgs {
  readonly operator: PublicKey;
  readonly payer: PublicKey;
  readonly policyAccount: PublicKey;
  readonly operatorAccount: PublicKey;
  readonly sourceTokenAccount: PublicKey;
  readonly destinationTokenAccount: PublicKey;
  readonly mint: PublicKey;
  /// Either SPL Token (Token-1, used by Circle USDC / USDT / most
  /// stablecoins) or SPL Token-2022 (used by mints with extensions).
  /// Decides which program receives the transferChecked CPI.
  readonly tokenProgram: PublicKey;
  readonly proofA: Uint8Array;
  readonly proofB: Uint8Array;
  readonly proofC: Uint8Array;
  readonly publicInputs: ReadonlyArray<Uint8Array>;
  readonly transferAmount: bigint;
  /// Extra accounts the SPL Token-2022 transfer-hook on a hook-bearing
  /// mint requires when transferChecked is invoked. Only set for Token-
  /// 2022 mints with the TransferHook extension; left undefined for
  /// plain Token-1 mints (USDC, USDT) since those have no hook.
  readonly hookExtraAccounts?: ReadonlyArray<{
    readonly pubkey: PublicKey;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
  }>;
}

/**
 * Builds the verifier's verify_payment_proof_v2_with_transfer instruction.
 * Single atomic ix that runs the full Groth16 verification, byte-binds the
 * proof's recipient/mint/amount to the actual transfer accounts, updates
 * OperatorState.daily_spent in line, and CPIs to SPL Token-2022's
 * transferChecked. The transfer-hook is bypassed; every check the hook
 * performed is enforced inside this ix.
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
 *  10: token_program              (Token-2022)
 *  11: system_program
 */
export function buildVerifyPaymentProofV2WithTransferIx(
  args: BuildVerifyWithTransferIxArgs,
): TransactionInstruction {
  if (args.proofA.length !== 64) throw new Error('proof_a must be 64 bytes');
  if (args.proofB.length !== 128) throw new Error('proof_b must be 128 bytes');
  if (args.proofC.length !== 64) throw new Error('proof_c must be 64 bytes');
  if (args.publicInputs.length !== PAYMENT_NR_INPUTS) {
    throw new Error(
      `public_inputs must have exactly ${PAYMENT_NR_INPUTS} entries (got ${args.publicInputs.length})`,
    );
  }
  for (let i = 0; i < args.publicInputs.length; i++) {
    if (args.publicInputs[i].length !== 32) {
      throw new Error(`public_inputs[${i}] must be 32 bytes`);
    }
  }

  const policyDataHash = Buffer.from(args.publicInputs[1]);
  const [proofRecordPDA] = deriveProofRecordPDA(args.operator, policyDataHash);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(args.operator);
  const [operatorStatePDA] = deriveOperatorStatePDA(args.operator);

  // Layout: disc[8] + proof_a[64] + proof_b[128] + proof_c[64]
  //       + public_inputs[NR_INPUTS * 32] + transfer_amount[u64 LE 8]
  const data = Buffer.alloc(8 + 64 + 128 + 64 + PAYMENT_NR_INPUTS * 32 + 8);
  let offset = 0;
  DISC_VERIFY_PAYMENT_V2_WITH_TRANSFER.copy(data, offset);
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

  const keys = [
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
  ];
  // Hook extra accounts piggyback as remaining_accounts. The Anchor handler
  // forwards them verbatim into the Token-2022 transferChecked CPI so the
  // auto-invoked transfer-hook sees its full required account list.
  if (args.hookExtraAccounts) {
    for (const acc of args.hookExtraAccounts) {
      keys.push({
        pubkey: acc.pubkey,
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      });
    }
  }
  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys,
    data,
  });
}

/**
 * Builds the Solana Ed25519Program native instruction that authenticates a
 * Stripe receipt hash. The on-chain MPP verifier (Adım 8c) reads this exact
 * instruction off the Sysvar Instructions account at index 0 of the same
 * transaction, parses signer/message/signature, and rejects anything that
 * does not match the proof's stripe_receipt_hash and the configured
 * MPP_AUTHORITY pubkey.
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
