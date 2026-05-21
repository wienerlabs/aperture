import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import { DEFAULT_VERIFIER_PROGRAM, DISCRIMINATORS } from './constants.js';
import { deriveAttestationRecordPDA, type ProgramIds } from './pda.js';

export interface BatchAttestationArgs {
  readonly operator: PublicKey;
  readonly payer: PublicKey;
  readonly batchHash: Uint8Array;
  readonly imageId?: Uint8Array;
  readonly journalDigest: Uint8Array;
  readonly totalPayments: number;
  readonly periodStartUnix: bigint;
  readonly periodEndUnix: bigint;
  readonly receiptData: Uint8Array;
}

/**
 * Builds the verifier's `verify_batch_attestation` (v1) instruction. v1 is
 * what production callers (agent-service and the dashboard) use; v2 exists
 * but is not yet wired anywhere.
 *
 * Accounts (programs/verifier/src/instructions/verify_batch.rs):
 *   0: attestation_record  (mut, init, seeds=[b"attestation", operator, batch_hash])
 *   1: operator            (signer)
 *   2: payer               (signer, mut)
 *   3: system_program
 *
 * Data layout (Borsh):
 *   disc[8]
 *   batch_hash[32]
 *   image_id[32]                  // 8 × u32 LE; batch path passes 32 zero bytes
 *   journal_digest[32]
 *   total_payments u32 LE
 *   period_start   i64 LE
 *   period_end     i64 LE
 *   receipt_data   Vec<u8>        // u32 LE length + bytes
 */
export function buildVerifyBatchAttestationIx(
  args: BatchAttestationArgs,
  programs?: ProgramIds,
): TransactionInstruction {
  if (args.batchHash.length !== 32) throw new Error('batchHash must be 32 bytes');
  if (args.journalDigest.length !== 32) {
    throw new Error('journalDigest must be 32 bytes');
  }
  const imageId = args.imageId ?? new Uint8Array(32);
  if (imageId.length !== 32) throw new Error('imageId must be 32 bytes');

  const programId = programs?.verifier ?? DEFAULT_VERIFIER_PROGRAM;
  const [attestationPda] = deriveAttestationRecordPDA(
    args.operator,
    args.batchHash,
    programs,
  );

  const headerLen = 8 + 32 + 32 + 32 + 4 + 8 + 8;
  const receiptVecLen = 4 + args.receiptData.length;
  const data = Buffer.alloc(headerLen + receiptVecLen);
  let offset = 0;
  Buffer.from(DISCRIMINATORS.verifyBatchAttestation).copy(data, offset);
  offset += 8;
  Buffer.from(args.batchHash).copy(data, offset);
  offset += 32;
  Buffer.from(imageId).copy(data, offset);
  offset += 32;
  Buffer.from(args.journalDigest).copy(data, offset);
  offset += 32;
  data.writeUInt32LE(args.totalPayments, offset);
  offset += 4;
  data.writeBigInt64LE(args.periodStartUnix, offset);
  offset += 8;
  data.writeBigInt64LE(args.periodEndUnix, offset);
  offset += 8;
  data.writeUInt32LE(args.receiptData.length, offset);
  offset += 4;
  Buffer.from(args.receiptData).copy(data, offset);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: attestationPda, isSigner: false, isWritable: true },
      { pubkey: args.operator, isSigner: true, isWritable: false },
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}
