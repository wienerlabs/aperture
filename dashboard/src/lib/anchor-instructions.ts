/**
 * Anchor program instruction builders for Aperture on-chain programs.
 * Replaces all Memo program usage with real CPI calls.
 */
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { config } from './config';

const POLICY_REGISTRY_PROGRAM = new PublicKey(config.programs.policyRegistry);
const VERIFIER_PROGRAM = new PublicKey(config.programs.verifier);

// -- Anchor discriminators (first 8 bytes of SHA-256("global:<method_name>")) --

const DISCRIMINATORS = {
  initializeOperator: Buffer.from([155, 33, 216, 254, 233, 227, 175, 212]),
  registerPolicy: Buffer.from([62, 66, 167, 36, 252, 227, 38, 132]),
  updatePolicy: Buffer.from([212, 245, 246, 7, 163, 151, 18, 57]),
  verifyPaymentProof: Buffer.from([247, 147, 241, 26, 26, 113, 39, 66]),
  verifyBatchAttestation: Buffer.from([85, 129, 17, 164, 94, 99, 86, 45]),
} as const;

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

export async function buildRegisterPolicyIx(
  authority: PublicKey,
  policyIdStr: string,
  compiledPolicyJson: string
): Promise<{ instruction: TransactionInstruction; policyPDA: PublicKey }> {
  const policyIdBytes = await sha256Bytes(policyIdStr);
  const merkleRoot = await sha256Bytes(compiledPolicyJson);
  const policyDataHash = await sha256Bytes(compiledPolicyJson + ':data');

  const [operatorAccount] = deriveOperatorPDA(authority);
  const [policyPDA] = derivePolicyPDA(operatorAccount, policyIdBytes);

  // Borsh serialize: discriminator + policy_id[32] + merkle_root[32] + policy_data_hash[32]
  const data = Buffer.alloc(8 + 32 + 32 + 32);
  DISCRIMINATORS.registerPolicy.copy(data, 0);
  Buffer.from(policyIdBytes).copy(data, 8);
  Buffer.from(merkleRoot).copy(data, 40);
  Buffer.from(policyDataHash).copy(data, 72);

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

export async function buildUpdatePolicyIx(
  authority: PublicKey,
  operatorAccount: PublicKey,
  policyPDA: PublicKey,
  compiledPolicyJson: string
): Promise<TransactionInstruction> {
  const newMerkleRoot = await sha256Bytes(compiledPolicyJson);
  const newPolicyDataHash = await sha256Bytes(compiledPolicyJson + ':data');

  // Borsh serialize: discriminator + new_merkle_root[32] + new_policy_data_hash[32]
  const data = Buffer.alloc(8 + 32 + 32);
  DISCRIMINATORS.updatePolicy.copy(data, 0);
  Buffer.from(newMerkleRoot).copy(data, 8);
  Buffer.from(newPolicyDataHash).copy(data, 40);

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

// -- Utility exports --

export { hexToBytes32, stringToBytes32, sha256Bytes };
