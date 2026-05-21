import { describe, expect, it } from 'vitest';
import { Keypair, SystemProgram } from '@solana/web3.js';
import {
  DEFAULT_POLICY_REGISTRY_PROGRAM,
  DISCRIMINATORS,
  buildDeactivatePolicyIx,
  buildInitializeOperatorIx,
  buildRegisterPolicyIx,
  buildUpdatePolicyIx,
  deriveOperatorPDA,
  derivePolicyPDA,
} from '../../src/anchor/index.js';

describe('buildInitializeOperatorIx', () => {
  const authority = Keypair.generate().publicKey;

  it('targets policy-registry with the right discriminator', () => {
    const ix = buildInitializeOperatorIx(authority, 'ops-team');
    expect(ix.programId.equals(DEFAULT_POLICY_REGISTRY_PROGRAM)).toBe(true);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(
      Array.from(DISCRIMINATORS.initializeOperator),
    );
  });

  it('Borsh-encodes the operator name as u32-length + bytes', () => {
    const ix = buildInitializeOperatorIx(authority, 'abc');
    const len = ix.data.readUInt32LE(8);
    expect(len).toBe(3);
    expect(ix.data.subarray(12, 12 + 3).toString('utf-8')).toBe('abc');
  });

  it('orders accounts as [operator_pda, authority, system_program]', () => {
    const ix = buildInitializeOperatorIx(authority, 'x');
    const [operatorPda] = deriveOperatorPDA(authority);
    expect(ix.keys[0].pubkey.equals(operatorPda)).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.equals(authority)).toBe(true);
    expect(ix.keys[1].isSigner).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
    expect(ix.keys[2].pubkey.equals(SystemProgram.programId)).toBe(true);
  });
});

describe('buildRegisterPolicyIx', () => {
  const authority = Keypair.generate().publicKey;

  it('encodes disc + policy_id + merkle_root + policy_data_hash', () => {
    const policyId32 = new Uint8Array(32).fill(1);
    const merkle = new Uint8Array(32).fill(2);
    const dataHash = new Uint8Array(32).fill(3);
    const ix = buildRegisterPolicyIx({
      authority,
      policyId32,
      merkleRoot: merkle,
      policyDataHash: dataHash,
    });
    expect(ix.data.length).toBe(8 + 32 + 32 + 32);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(
      Array.from(DISCRIMINATORS.registerPolicy),
    );
    expect(ix.data[8]).toBe(1);
    expect(ix.data[8 + 32]).toBe(2);
    expect(ix.data[8 + 64]).toBe(3);
  });

  it('keys = [policy_pda(mut), operator_pda(mut), authority(signer,mut), system]', () => {
    const policyId32 = new Uint8Array(32).fill(7);
    const ix = buildRegisterPolicyIx({
      authority,
      policyId32,
      merkleRoot: new Uint8Array(32),
      policyDataHash: new Uint8Array(32),
    });
    const [operatorPda] = deriveOperatorPDA(authority);
    const [policyPda] = derivePolicyPDA(operatorPda, policyId32);
    expect(ix.keys[0].pubkey.equals(policyPda)).toBe(true);
    expect(ix.keys[0].isWritable).toBe(true);
    expect(ix.keys[1].pubkey.equals(operatorPda)).toBe(true);
    expect(ix.keys[1].isWritable).toBe(true);
    expect(ix.keys[2].pubkey.equals(authority)).toBe(true);
    expect(ix.keys[2].isSigner).toBe(true);
    expect(ix.keys[2].isWritable).toBe(true);
    expect(ix.keys[3].pubkey.equals(SystemProgram.programId)).toBe(true);
  });

  it('rejects non-32-byte inputs', () => {
    expect(() =>
      buildRegisterPolicyIx({
        authority,
        policyId32: new Uint8Array(31),
        merkleRoot: new Uint8Array(32),
        policyDataHash: new Uint8Array(32),
      }),
    ).toThrow(/policyId32 must be 32 bytes/);
  });
});

describe('buildUpdatePolicyIx', () => {
  const authority = Keypair.generate().publicKey;

  it('omits policy_id from the arg payload', () => {
    const ix = buildUpdatePolicyIx({
      authority,
      policyId32: new Uint8Array(32).fill(9),
      newMerkleRoot: new Uint8Array(32).fill(4),
      newPolicyDataHash: new Uint8Array(32).fill(5),
    });
    expect(ix.data.length).toBe(8 + 32 + 32);
    expect(Array.from(ix.data.subarray(0, 8))).toEqual(
      Array.from(DISCRIMINATORS.updatePolicy),
    );
    expect(ix.data[8]).toBe(4);
    expect(ix.data[8 + 32]).toBe(5);
  });

  it('authority is signer but NOT mut (matches Anchor handler)', () => {
    const ix = buildUpdatePolicyIx({
      authority,
      policyId32: new Uint8Array(32),
      newMerkleRoot: new Uint8Array(32),
      newPolicyDataHash: new Uint8Array(32),
    });
    expect(ix.keys[2].pubkey.equals(authority)).toBe(true);
    expect(ix.keys[2].isSigner).toBe(true);
    expect(ix.keys[2].isWritable).toBe(false);
  });
});

describe('buildDeactivatePolicyIx', () => {
  it('has no args beyond the 8-byte discriminator', () => {
    const ix = buildDeactivatePolicyIx(
      Keypair.generate().publicKey,
      new Uint8Array(32).fill(1),
    );
    expect(ix.data.length).toBe(8);
    expect(Array.from(ix.data)).toEqual(
      Array.from(DISCRIMINATORS.deactivatePolicy),
    );
  });
});
