/**
 * Squads V4 multisig types shared between the policy-service backend and
 * the Next.js dashboard. Mirrors what we cache in the operator_multisig
 * Postgres table plus the Squads-on-chain shape we render.
 */

/** Squads v4 vault PDA — derived from a multisig + vault index. */
export type Base58Address = string;

export interface MultisigMember {
  /** Base58 pubkey of the member. */
  readonly key: Base58Address;
  /**
   * Decoded permission mask (1 = propose, 2 = vote, 4 = execute).
   * The Squads SDK exposes this as a `Permissions` object; we serialise
   * the underlying numeric mask so the wire protocol stays simple.
   */
  readonly permissionsMask: number;
}

export interface MultisigBinding {
  readonly operatorId: string;
  readonly multisigAddress: Base58Address;
  readonly vaultIndex: number;
  readonly vaultPda: Base58Address;
  readonly threshold: number;
  readonly memberCount: number;
  readonly members: readonly MultisigMember[];
  readonly label: string | null;
  readonly bindTxSignature: string | null;
  readonly lastSyncedAt: string | null;
  readonly boundAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MultisigBindingInput {
  readonly operatorId: string;
  readonly multisigAddress: Base58Address;
  readonly vaultIndex: number;
  readonly label?: string;
  readonly bindTxSignature?: string;
}

export interface MultisigOnchainSnapshot {
  readonly multisigAddress: Base58Address;
  readonly threshold: number;
  readonly members: readonly MultisigMember[];
  readonly vaultPda: Base58Address;
  readonly transactionIndex: number;
}

export type MultisigAuditAction = 'bind' | 'unbind' | 'sync' | 'rotate';

export interface MultisigAuditEntry {
  readonly id: number;
  readonly operatorId: string;
  readonly action: MultisigAuditAction;
  readonly multisigAddress: Base58Address | null;
  readonly vaultIndex: number | null;
  readonly txSignature: string | null;
  readonly payload: Record<string, unknown>;
  readonly actor: string;
  readonly createdAt: string;
}

export type MultisigProposalAction =
  | 'register_policy'
  | 'update_policy'
  | 'deactivate_policy'
  | 'rotate_multisig'
  | 'custom';

export type MultisigProposalStatus =
  | 'pending'
  | 'approved'
  | 'executed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export interface MultisigProposal {
  readonly id: string;
  readonly operatorId: string;
  readonly multisigAddress: Base58Address;
  readonly transactionIndex: number;
  readonly transactionPda: Base58Address;
  readonly proposalPda: Base58Address | null;
  readonly action: MultisigProposalAction;
  readonly policyId: string | null;
  readonly targetMerkleRoot: string | null;
  readonly targetPolicyHash: string | null;
  readonly status: MultisigProposalStatus;
  readonly approvalCount: number;
  readonly rejectionCount: number;
  readonly executedTx: string | null;
  readonly createdBy: Base58Address;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly executedAt: string | null;
}

export interface MultisigProposalInput {
  readonly operatorId: string;
  readonly multisigAddress: Base58Address;
  readonly transactionIndex: number;
  readonly transactionPda: Base58Address;
  readonly proposalPda?: Base58Address;
  readonly action: MultisigProposalAction;
  readonly policyId?: string;
  readonly targetMerkleRoot?: string;
  readonly targetPolicyHash?: string;
  readonly createdBy: Base58Address;
}
