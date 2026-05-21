import {
  Ed25519Program,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  DEFAULT_VERIFIER_PROGRAM,
  DISCRIMINATORS,
  PAYMENT_PUBLIC_INPUTS,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from './constants.js';
import {
  deriveComplianceStatusPDA,
  deriveOperatorStatePDA,
  deriveProofRecordPDA,
  type ProgramIds,
} from './pda.js';

/** Extra account a Token-2022 transfer-hook needs to be forwarded. */
export interface HookExtraAccount {
  readonly pubkey: PublicKey;
  readonly isSigner: boolean;
  readonly isWritable: boolean;
}

export interface VerifyPaymentProofArgs {
  readonly operator: PublicKey;
  readonly payer: PublicKey;
  readonly policyAccount: PublicKey;
  readonly operatorAccount: PublicKey;
  readonly proofA: Uint8Array;
  readonly proofB: Uint8Array;
  readonly proofC: Uint8Array;
  readonly publicInputs: ReadonlyArray<Uint8Array>;
}

export interface VerifyPaymentWithTransferArgs extends VerifyPaymentProofArgs {
  readonly sourceTokenAccount: PublicKey;
  readonly destinationTokenAccount: PublicKey;
  readonly mint: PublicKey;
  readonly tokenProgram: PublicKey;
  readonly transferAmount: bigint;
  readonly hookExtraAccounts?: ReadonlyArray<HookExtraAccount>;
}

export interface VerifyMppProofArgs extends VerifyPaymentProofArgs {}

function validateProofBytes(
  proofA: Uint8Array,
  proofB: Uint8Array,
  proofC: Uint8Array,
  publicInputs: ReadonlyArray<Uint8Array>,
): void {
  if (proofA.length !== 64) throw new Error('proof_a must be 64 bytes');
  if (proofB.length !== 128) throw new Error('proof_b must be 128 bytes');
  if (proofC.length !== 64) throw new Error('proof_c must be 64 bytes');
  if (publicInputs.length !== PAYMENT_PUBLIC_INPUTS) {
    throw new Error(
      `public_inputs must have exactly ${PAYMENT_PUBLIC_INPUTS} entries ` +
        `(got ${publicInputs.length})`,
    );
  }
  for (let i = 0; i < publicInputs.length; i++) {
    if (publicInputs[i].length !== 32) {
      throw new Error(`public_inputs[${i}] must be 32 bytes`);
    }
  }
}

function writeProofPayload(
  data: Buffer,
  discriminator: Uint8Array,
  proofA: Uint8Array,
  proofB: Uint8Array,
  proofC: Uint8Array,
  publicInputs: ReadonlyArray<Uint8Array>,
): number {
  let offset = 0;
  Buffer.from(discriminator).copy(data, offset);
  offset += 8;
  Buffer.from(proofA).copy(data, offset);
  offset += 64;
  Buffer.from(proofB).copy(data, offset);
  offset += 128;
  Buffer.from(proofC).copy(data, offset);
  offset += 64;
  for (const pi of publicInputs) {
    Buffer.from(pi).copy(data, offset);
    offset += 32;
  }
  return offset;
}

/**
 * Builds the verifier's `verify_payment_proof_v2_with_transfer` instruction:
 * Groth16 verify + recipient/mint/amount byte-binding + OperatorState bump +
 * inner SPL Token transferChecked CPI, all atomic.
 *
 * Account order MUST match `VerifyPaymentProofV2WithTransfer` in
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
 *  remaining: optional Token-2022 transfer-hook extra accounts
 */
export function buildVerifyPaymentProofV2WithTransferIx(
  args: VerifyPaymentWithTransferArgs,
  programs?: ProgramIds,
): TransactionInstruction {
  validateProofBytes(args.proofA, args.proofB, args.proofC, args.publicInputs);
  const programId = programs?.verifier ?? DEFAULT_VERIFIER_PROGRAM;
  const policyDataHash = args.publicInputs[1];
  const [proofRecordPDA] = deriveProofRecordPDA(args.operator, policyDataHash, programs);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(args.operator, programs);
  const [operatorStatePDA] = deriveOperatorStatePDA(args.operator, programs);

  // Layout: disc[8] + proof_a[64] + proof_b[128] + proof_c[64]
  //       + public_inputs[NR_INPUTS * 32] + transfer_amount[u64 LE 8]
  const data = Buffer.alloc(8 + 64 + 128 + 64 + PAYMENT_PUBLIC_INPUTS * 32 + 8);
  const offset = writeProofPayload(
    data,
    DISCRIMINATORS.verifyPaymentProofV2WithTransfer,
    args.proofA,
    args.proofB,
    args.proofC,
    args.publicInputs,
  );
  data.writeBigUInt64LE(args.transferAmount, offset);

  const keys: TransactionInstruction['keys'] = [
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
  if (args.hookExtraAccounts) {
    for (const acc of args.hookExtraAccounts) {
      keys.push({
        pubkey: acc.pubkey,
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      });
    }
  }
  return new TransactionInstruction({ programId, keys, data });
}

/**
 * Builds the verifier's `verify_mpp_payment_proof` instruction. Caller MUST
 * place the matching Solana Ed25519Program verify instruction at index 0 of
 * the same transaction (see `buildEd25519VerifyIx`). The on-chain handler
 * reads it via the Sysvar Instructions account to authenticate the Stripe
 * receipt hash committed in publicInputs[9].
 *
 * Account order:
 *   0: proof_record         (mut, init_if_needed)
 *   1: compliance_status    (mut, init_if_needed)
 *   2: operator_state       (mut, init_if_needed)
 *   3: policy_account       (read)
 *   4: operator_account     (read)
 *   5: operator             (signer)
 *   6: payer                (signer, mut)
 *   7: instructions_sysvar  (read)
 *   8: system_program
 */
export function buildVerifyMppPaymentProofIx(
  args: VerifyMppProofArgs,
  programs?: ProgramIds,
): TransactionInstruction {
  validateProofBytes(args.proofA, args.proofB, args.proofC, args.publicInputs);
  const programId = programs?.verifier ?? DEFAULT_VERIFIER_PROGRAM;
  const policyDataHash = args.publicInputs[1];
  const [proofRecordPDA] = deriveProofRecordPDA(args.operator, policyDataHash, programs);
  const [complianceStatusPDA] = deriveComplianceStatusPDA(args.operator, programs);
  const [operatorStatePDA] = deriveOperatorStatePDA(args.operator, programs);

  const data = Buffer.alloc(8 + 64 + 128 + 64 + PAYMENT_PUBLIC_INPUTS * 32);
  writeProofPayload(
    data,
    DISCRIMINATORS.verifyMppPaymentProof,
    args.proofA,
    args.proofB,
    args.proofC,
    args.publicInputs,
  );

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: proofRecordPDA, isSigner: false, isWritable: true },
      { pubkey: complianceStatusPDA, isSigner: false, isWritable: true },
      { pubkey: operatorStatePDA, isSigner: false, isWritable: true },
      { pubkey: args.policyAccount, isSigner: false, isWritable: false },
      { pubkey: args.operatorAccount, isSigner: false, isWritable: false },
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: args.payer, isSigner: true, isWritable: true },
      {
        pubkey: SYSVAR_INSTRUCTIONS_PUBKEY,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds Solana's native Ed25519Program verify instruction. The on-chain MPP
 * verifier reads this exact instruction from the Sysvar Instructions account
 * at index 0 of the transaction. The 32-byte message MUST be the raw bytes
 * of the Stripe receipt's Poseidon hash; the verifier compares it byte-for-
 * byte against publicInputs[9].
 */
export function buildEd25519VerifyIx(
  authorityPubkey: PublicKey,
  signature: Uint8Array,
  message: Uint8Array,
): TransactionInstruction {
  if (signature.length !== 64) throw new Error('signature must be 64 bytes');
  if (message.length !== 32) {
    throw new Error('message must be exactly 32 bytes (the Poseidon receipt hash)');
  }
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: authorityPubkey.toBytes(),
    message,
    signature,
  });
}
