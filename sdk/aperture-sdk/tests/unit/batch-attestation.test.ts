import { describe, expect, it } from 'vitest';
import { Keypair, SystemProgram } from '@solana/web3.js';
import {
  DEFAULT_VERIFIER_PROGRAM,
  DISCRIMINATORS,
  buildVerifyBatchAttestationIx,
  deriveAttestationRecordPDA,
} from '../../src/anchor/index.js';

describe('buildVerifyBatchAttestationIx', () => {
  const operator = Keypair.generate().publicKey;

  it('encodes header + Borsh Vec<u8> receipt at the tail', () => {
    const batchHash = new Uint8Array(32).fill(11);
    const journalDigest = new Uint8Array(32).fill(22);
    const receiptData = new TextEncoder().encode('batch:abc:0:0:0');
    const ix = buildVerifyBatchAttestationIx({
      operator,
      payer: operator,
      batchHash,
      journalDigest,
      totalPayments: 7,
      periodStartUnix: 1700000000n,
      periodEndUnix: 1700000600n,
      receiptData,
    });

    expect(ix.programId.equals(DEFAULT_VERIFIER_PROGRAM)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(
      Array.from(DISCRIMINATORS.verifyBatchAttestation),
    );

    let offset = 8;
    // batch_hash
    expect(ix.data[offset]).toBe(11);
    offset += 32;
    // image_id (all zeros default)
    expect(Array.from(ix.data.subarray(offset, offset + 32))).toEqual(
      Array.from(new Uint8Array(32)),
    );
    offset += 32;
    // journal_digest
    expect(ix.data[offset]).toBe(22);
    offset += 32;
    // total_payments
    expect(ix.data.readUInt32LE(offset)).toBe(7);
    offset += 4;
    // period_start
    expect(ix.data.readBigInt64LE(offset)).toBe(1700000000n);
    offset += 8;
    // period_end
    expect(ix.data.readBigInt64LE(offset)).toBe(1700000600n);
    offset += 8;
    // receipt vec
    expect(ix.data.readUInt32LE(offset)).toBe(receiptData.length);
    offset += 4;
    expect(ix.data.subarray(offset, offset + receiptData.length).toString('utf-8')).toBe(
      'batch:abc:0:0:0',
    );
  });

  it('attestation_record key matches deriveAttestationRecordPDA', () => {
    const batchHash = new Uint8Array(32).fill(3);
    const ix = buildVerifyBatchAttestationIx({
      operator,
      payer: operator,
      batchHash,
      journalDigest: new Uint8Array(32),
      totalPayments: 1,
      periodStartUnix: 0n,
      periodEndUnix: 1n,
      receiptData: new Uint8Array(0),
    });
    const [pda] = deriveAttestationRecordPDA(operator, batchHash);
    expect(ix.keys[0].pubkey.equals(pda)).toBe(true);
    expect(ix.keys[3].pubkey.equals(SystemProgram.programId)).toBe(true);
  });
});
