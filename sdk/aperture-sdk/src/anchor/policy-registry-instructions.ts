import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  DEFAULT_POLICY_REGISTRY_PROGRAM,
  DISCRIMINATORS,
} from './constants.js';
import { deriveOperatorPDA, derivePolicyPDA, type ProgramIds } from './pda.js';

/**
 * Builds the policy-registry `initialize_operator` instruction. Lazily called
 * by the SDK when the operator PDA does not yet exist on-chain; without this
 * the first `register_policy` would fail with AccountNotInitialized.
 *
 * Accounts (programs/policy-registry/src/instructions/initialize_operator.rs):
 *   0: operator_account     (mut, init, seeds=[b"operator", authority])
 *   1: authority            (mut, signer)
 *   2: system_program
 *
 * Args (Borsh):
 *   operator_name: String   (u32 LE length + UTF-8 bytes)
 */
export function buildInitializeOperatorIx(
  authority: PublicKey,
  operatorName: string,
  programs?: ProgramIds,
): TransactionInstruction {
  const programId = programs?.policyRegistry ?? DEFAULT_POLICY_REGISTRY_PROGRAM;
  const [operatorPda] = deriveOperatorPDA(authority, programs);
  const nameBytes = Buffer.from(operatorName, 'utf-8');
  const data = Buffer.alloc(8 + 4 + nameBytes.length);
  Buffer.from(DISCRIMINATORS.initializeOperator).copy(data, 0);
  data.writeUInt32LE(nameBytes.length, 8);
  nameBytes.copy(data, 12);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface RegisterPolicyArgs {
  readonly authority: PublicKey;
  readonly policyId32: Uint8Array;
  readonly merkleRoot: Uint8Array;
  readonly policyDataHash: Uint8Array;
}

/**
 * Builds the policy-registry `register_policy` instruction. The 32-byte
 * `policyId32` is the sha256 of the policy UUID string the policy-service
 * issued; the dashboard and policy-service compute it identically so the
 * derived PDA matches.
 *
 * Accounts:
 *   0: policy_account     (mut, init, seeds=[b"policy", operator_account, policy_id])
 *   1: operator_account   (mut, has_one=authority)
 *   2: authority          (mut, signer)
 *   3: system_program
 *
 * Args (Borsh):
 *   policy_id: [u8;32]
 *   merkle_root: [u8;32]
 *   policy_data_hash: [u8;32]
 */
export function buildRegisterPolicyIx(
  args: RegisterPolicyArgs,
  programs?: ProgramIds,
): TransactionInstruction {
  assert32(args.policyId32, 'policyId32');
  assert32(args.merkleRoot, 'merkleRoot');
  assert32(args.policyDataHash, 'policyDataHash');

  const programId = programs?.policyRegistry ?? DEFAULT_POLICY_REGISTRY_PROGRAM;
  const [operatorPda] = deriveOperatorPDA(args.authority, programs);
  const [policyPda] = derivePolicyPDA(operatorPda, args.policyId32, programs);

  const data = Buffer.alloc(8 + 32 + 32 + 32);
  Buffer.from(DISCRIMINATORS.registerPolicy).copy(data, 0);
  Buffer.from(args.policyId32).copy(data, 8);
  Buffer.from(args.merkleRoot).copy(data, 40);
  Buffer.from(args.policyDataHash).copy(data, 72);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: operatorPda, isSigner: false, isWritable: true },
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface UpdatePolicyArgs {
  readonly authority: PublicKey;
  readonly policyId32: Uint8Array;
  readonly newMerkleRoot: Uint8Array;
  readonly newPolicyDataHash: Uint8Array;
}

/**
 * Builds the policy-registry `update_policy` instruction. Bumps the on-chain
 * version counter and replaces the Merkle root + policy_data_hash.
 *
 * Accounts:
 *   0: policy_account     (mut, constraint=active)
 *   1: operator_account   (read, has_one=authority)
 *   2: authority          (signer)
 *
 * Args (Borsh):
 *   new_merkle_root: [u8;32]
 *   new_policy_data_hash: [u8;32]
 */
export function buildUpdatePolicyIx(
  args: UpdatePolicyArgs,
  programs?: ProgramIds,
): TransactionInstruction {
  assert32(args.policyId32, 'policyId32');
  assert32(args.newMerkleRoot, 'newMerkleRoot');
  assert32(args.newPolicyDataHash, 'newPolicyDataHash');

  const programId = programs?.policyRegistry ?? DEFAULT_POLICY_REGISTRY_PROGRAM;
  const [operatorPda] = deriveOperatorPDA(args.authority, programs);
  const [policyPda] = derivePolicyPDA(operatorPda, args.policyId32, programs);

  const data = Buffer.alloc(8 + 32 + 32);
  Buffer.from(DISCRIMINATORS.updatePolicy).copy(data, 0);
  Buffer.from(args.newMerkleRoot).copy(data, 8);
  Buffer.from(args.newPolicyDataHash).copy(data, 40);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: operatorPda, isSigner: false, isWritable: false },
      { pubkey: args.authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/**
 * Builds the policy-registry `deactivate_policy` instruction. Marks an
 * existing policy as inactive on-chain; the verifier rejects proofs against
 * inactive policies.
 */
export function buildDeactivatePolicyIx(
  authority: PublicKey,
  policyId32: Uint8Array,
  programs?: ProgramIds,
): TransactionInstruction {
  assert32(policyId32, 'policyId32');
  const programId = programs?.policyRegistry ?? DEFAULT_POLICY_REGISTRY_PROGRAM;
  const [operatorPda] = deriveOperatorPDA(authority, programs);
  const [policyPda] = derivePolicyPDA(operatorPda, policyId32, programs);

  const data = Buffer.from(DISCRIMINATORS.deactivatePolicy);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: operatorPda, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function assert32(buf: Uint8Array, field: string): void {
  if (buf.length !== 32) {
    throw new Error(`${field} must be 32 bytes, got ${buf.length}`);
  }
}
