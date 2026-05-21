import { PublicKey } from '@solana/web3.js';
import {
  DEFAULT_POLICY_REGISTRY_PROGRAM,
  DEFAULT_VERIFIER_PROGRAM,
} from './constants.js';

/**
 * Optional override of the on-chain program IDs. Production deployments leave
 * these unset to use the canonical devnet programs; integration tests can
 * point them at a local validator.
 */
export interface ProgramIds {
  readonly verifier?: PublicKey;
  readonly policyRegistry?: PublicKey;
}

function verifier(p?: ProgramIds): PublicKey {
  return p?.verifier ?? DEFAULT_VERIFIER_PROGRAM;
}

function policyRegistry(p?: ProgramIds): PublicKey {
  return p?.policyRegistry ?? DEFAULT_POLICY_REGISTRY_PROGRAM;
}

/** Operator PDA: seeds ["operator", authority] under the policy-registry. */
export function deriveOperatorPDA(
  authority: PublicKey,
  programs?: ProgramIds,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    policyRegistry(programs),
  );
}

/** Policy PDA: seeds ["policy", operatorAccount, sha256(policyId)]. */
export function derivePolicyPDA(
  operatorAccount: PublicKey,
  policyIdBytes: Uint8Array,
  programs?: ProgramIds,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('policy'),
      operatorAccount.toBuffer(),
      Buffer.from(policyIdBytes),
    ],
    policyRegistry(programs),
  );
}

/** ProofRecord PDA: seeds ["proof", operator, policyDataHash] under the verifier. */
export function deriveProofRecordPDA(
  operator: PublicKey,
  policyDataHash: Uint8Array,
  programs?: ProgramIds,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), operator.toBuffer(), Buffer.from(policyDataHash)],
    verifier(programs),
  );
}

/** ComplianceStatus PDA: seeds ["compliance", operator] under the verifier. */
export function deriveComplianceStatusPDA(
  operator: PublicKey,
  programs?: ProgramIds,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('compliance'), operator.toBuffer()],
    verifier(programs),
  );
}

/** OperatorState PDA: seeds ["operator_state", operator] under the verifier. */
export function deriveOperatorStatePDA(
  operator: PublicKey,
  programs?: ProgramIds,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator_state'), operator.toBuffer()],
    verifier(programs),
  );
}

/** AttestationRecord PDA: seeds ["attestation", operator, batchHash]. */
export function deriveAttestationRecordPDA(
  operator: PublicKey,
  batchHash: Uint8Array,
  programs?: ProgramIds,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('attestation'),
      operator.toBuffer(),
      Buffer.from(batchHash),
    ],
    verifier(programs),
  );
}
