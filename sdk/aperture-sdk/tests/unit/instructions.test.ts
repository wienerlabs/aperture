import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import {
  DEFAULT_VERIFIER_PROGRAM,
  DISCRIMINATORS,
  PAYMENT_PUBLIC_INPUTS,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  buildEd25519VerifyIx,
  buildVerifyMppPaymentProofIx,
  buildVerifyPaymentProofV2WithTransferIx,
  deriveComplianceStatusPDA,
  deriveOperatorStatePDA,
  deriveProofRecordPDA,
} from '../../src/anchor/index.js';

function makeProofBytes() {
  const publicInputs: Uint8Array[] = [];
  for (let i = 0; i < PAYMENT_PUBLIC_INPUTS; i++) {
    publicInputs.push(new Uint8Array(32).fill(i + 1));
  }
  return {
    proofA: new Uint8Array(64).fill(1),
    proofB: new Uint8Array(128).fill(2),
    proofC: new Uint8Array(64).fill(3),
    publicInputs,
  };
}

describe('buildVerifyPaymentProofV2WithTransferIx', () => {
  const operator = Keypair.generate().publicKey;
  const policyAccount = Keypair.generate().publicKey;
  const operatorAccount = Keypair.generate().publicKey;
  const sourceAta = Keypair.generate().publicKey;
  const destAta = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const tokenProgram = Keypair.generate().publicKey;

  it('encodes discriminator, proof bytes, public inputs, transfer amount', () => {
    const { proofA, proofB, proofC, publicInputs } = makeProofBytes();
    const transferAmount = 1_234_567n;
    const ix = buildVerifyPaymentProofV2WithTransferIx({
      operator,
      payer: operator,
      policyAccount,
      operatorAccount,
      sourceTokenAccount: sourceAta,
      destinationTokenAccount: destAta,
      mint,
      tokenProgram,
      proofA,
      proofB,
      proofC,
      publicInputs,
      transferAmount,
    });

    expect(ix.programId.equals(DEFAULT_VERIFIER_PROGRAM)).toBe(true);

    const data = ix.data;
    const expectedLength = 8 + 64 + 128 + 64 + PAYMENT_PUBLIC_INPUTS * 32 + 8;
    expect(data.length).toBe(expectedLength);

    // Discriminator
    expect(
      Array.from(data.subarray(0, 8)),
    ).toEqual(
      Array.from(DISCRIMINATORS.verifyPaymentProofV2WithTransfer),
    );

    // Transfer amount at the very end
    const tail = data.subarray(expectedLength - 8, expectedLength);
    expect(tail.readBigUInt64LE(0)).toBe(transferAmount);
  });

  it('orders accounts exactly as the Anchor handler expects', () => {
    const { proofA, proofB, proofC, publicInputs } = makeProofBytes();
    const ix = buildVerifyPaymentProofV2WithTransferIx({
      operator,
      payer: operator,
      policyAccount,
      operatorAccount,
      sourceTokenAccount: sourceAta,
      destinationTokenAccount: destAta,
      mint,
      tokenProgram,
      proofA,
      proofB,
      proofC,
      publicInputs,
      transferAmount: 100n,
    });

    const [proofRecordPda] = deriveProofRecordPDA(operator, publicInputs[1]);
    const [complianceStatusPda] = deriveComplianceStatusPDA(operator);
    const [operatorStatePda] = deriveOperatorStatePDA(operator);

    const expectedKeys = [
      proofRecordPda,
      complianceStatusPda,
      operatorStatePda,
      policyAccount,
      operatorAccount,
      operator,
      operator,
      sourceAta,
      destAta,
      mint,
      tokenProgram,
      SystemProgram.programId,
    ];
    expect(ix.keys.length).toBe(expectedKeys.length);
    ix.keys.forEach((k, idx) => {
      expect(k.pubkey.equals(expectedKeys[idx])).toBe(true);
    });
  });

  it('appends Token-2022 hook extra accounts as remaining_accounts', () => {
    const { proofA, proofB, proofC, publicInputs } = makeProofBytes();
    const extra = Keypair.generate().publicKey;
    const ix = buildVerifyPaymentProofV2WithTransferIx({
      operator,
      payer: operator,
      policyAccount,
      operatorAccount,
      sourceTokenAccount: sourceAta,
      destinationTokenAccount: destAta,
      mint,
      tokenProgram,
      proofA,
      proofB,
      proofC,
      publicInputs,
      transferAmount: 1n,
      hookExtraAccounts: [{ pubkey: extra, isSigner: false, isWritable: true }],
    });

    expect(ix.keys.length).toBe(13);
    const tail = ix.keys[12];
    expect(tail.pubkey.equals(extra)).toBe(true);
    expect(tail.isWritable).toBe(true);
    expect(tail.isSigner).toBe(false);
  });

  it('rejects malformed proof byte lengths', () => {
    const { proofB, proofC, publicInputs } = makeProofBytes();
    expect(() =>
      buildVerifyPaymentProofV2WithTransferIx({
        operator,
        payer: operator,
        policyAccount,
        operatorAccount,
        sourceTokenAccount: sourceAta,
        destinationTokenAccount: destAta,
        mint,
        tokenProgram,
        proofA: new Uint8Array(63),
        proofB,
        proofC,
        publicInputs,
        transferAmount: 1n,
      }),
    ).toThrow(/proof_a must be 64 bytes/);
  });
});

describe('buildVerifyMppPaymentProofIx', () => {
  const operator = Keypair.generate().publicKey;
  const policyAccount = Keypair.generate().publicKey;
  const operatorAccount = Keypair.generate().publicKey;

  it('includes the instructions sysvar between payer and system program', () => {
    const { proofA, proofB, proofC, publicInputs } = makeProofBytes();
    const ix = buildVerifyMppPaymentProofIx({
      operator,
      payer: operator,
      policyAccount,
      operatorAccount,
      proofA,
      proofB,
      proofC,
      publicInputs,
    });

    expect(ix.programId.equals(DEFAULT_VERIFIER_PROGRAM)).toBe(true);
    expect(ix.keys[7].pubkey.equals(SYSVAR_INSTRUCTIONS_PUBKEY)).toBe(true);
    expect(ix.keys[8].pubkey.equals(SystemProgram.programId)).toBe(true);
    expect(
      Array.from(ix.data.subarray(0, 8)),
    ).toEqual(Array.from(DISCRIMINATORS.verifyMppPaymentProof));
  });
});

describe('buildEd25519VerifyIx', () => {
  const authority = Keypair.generate().publicKey;

  it('rejects wrong signature size', () => {
    expect(() =>
      buildEd25519VerifyIx(authority, new Uint8Array(63), new Uint8Array(32)),
    ).toThrow(/signature must be 64 bytes/);
  });

  it('rejects wrong message size', () => {
    expect(() =>
      buildEd25519VerifyIx(authority, new Uint8Array(64), new Uint8Array(31)),
    ).toThrow(/32 bytes/);
  });

  it('builds an Ed25519Program instruction when sizes are correct', () => {
    const ix = buildEd25519VerifyIx(
      authority,
      new Uint8Array(64).fill(1),
      new Uint8Array(32).fill(2),
    );
    expect(ix.programId).toBeInstanceOf(PublicKey);
    expect(ix.data.length).toBeGreaterThan(0);
  });
});
