import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  DEFAULT_POLICY_REGISTRY_PROGRAM,
  DEFAULT_VERIFIER_PROGRAM,
  deriveAttestationRecordPDA,
  deriveComplianceStatusPDA,
  deriveOperatorPDA,
  deriveOperatorStatePDA,
  derivePolicyPDA,
  deriveProofRecordPDA,
} from '../../src/anchor/index.js';
import { sha256 } from '../../src/util/base.js';

describe('PDA derivations', () => {
  const operator = Keypair.generate().publicKey;
  const policyId = 'demo-policy-uuid-1234';

  it('operator PDA seeds = ["operator", authority]', () => {
    const [pda, bump] = deriveOperatorPDA(operator);
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('operator'), operator.toBuffer()],
      DEFAULT_POLICY_REGISTRY_PROGRAM,
    );
    expect(pda.equals(expected)).toBe(true);
    expect(bump).toBe(expectedBump);
  });

  it('policy PDA seeds = ["policy", operatorAccount, sha256(policyId)]', () => {
    const [operatorAccount] = deriveOperatorPDA(operator);
    const policyIdBytes = sha256(policyId);
    const [pda] = derivePolicyPDA(operatorAccount, policyIdBytes);
    const [expected] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('policy'),
        operatorAccount.toBuffer(),
        Buffer.from(policyIdBytes),
      ],
      DEFAULT_POLICY_REGISTRY_PROGRAM,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it('proof record PDA seeds = ["proof", operator, policyDataHash]', () => {
    const policyDataHash = new Uint8Array(32).fill(7);
    const [pda] = deriveProofRecordPDA(operator, policyDataHash);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('proof'), operator.toBuffer(), Buffer.from(policyDataHash)],
      DEFAULT_VERIFIER_PROGRAM,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it('compliance status PDA seeds = ["compliance", operator]', () => {
    const [pda] = deriveComplianceStatusPDA(operator);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('compliance'), operator.toBuffer()],
      DEFAULT_VERIFIER_PROGRAM,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it('operator state PDA seeds = ["operator_state", operator]', () => {
    const [pda] = deriveOperatorStatePDA(operator);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('operator_state'), operator.toBuffer()],
      DEFAULT_VERIFIER_PROGRAM,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it('attestation record PDA seeds = ["attestation", operator, batchHash]', () => {
    const batchHash = new Uint8Array(32).fill(11);
    const [pda] = deriveAttestationRecordPDA(operator, batchHash);
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('attestation'), operator.toBuffer(), Buffer.from(batchHash)],
      DEFAULT_VERIFIER_PROGRAM,
    );
    expect(pda.equals(expected)).toBe(true);
  });

  it('honors program ID overrides', () => {
    const customVerifier = Keypair.generate().publicKey;
    const [pda] = deriveProofRecordPDA(
      operator,
      new Uint8Array(32),
      { verifier: customVerifier },
    );
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('proof'), operator.toBuffer(), Buffer.alloc(32)],
      customVerifier,
    );
    expect(pda.equals(expected)).toBe(true);
  });
});
