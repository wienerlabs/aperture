import { query } from '../utils/database.js';
import type {
  MultisigProposal,
  MultisigProposalInput,
  MultisigProposalAction,
  MultisigProposalStatus,
} from '@aperture/types';

interface ProposalRow {
  id: string;
  operator_id: string;
  multisig_address: string;
  transaction_index: string;
  transaction_pda: string;
  proposal_pda: string | null;
  action: MultisigProposalAction;
  policy_id: string | null;
  target_merkle_root: string | null;
  target_policy_hash: string | null;
  status: MultisigProposalStatus;
  approval_count: number;
  rejection_count: number;
  executed_tx: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  executed_at: Date | null;
}

function rowToProposal(row: ProposalRow): MultisigProposal {
  return {
    id: row.id,
    operatorId: row.operator_id,
    multisigAddress: row.multisig_address,
    // Postgres returns BIGINT as string; the dashboard treats it as a
    // plain JS number because Squads transaction indexes never grow past
    // 2^53 in practice.
    transactionIndex: Number(row.transaction_index),
    transactionPda: row.transaction_pda,
    proposalPda: row.proposal_pda,
    action: row.action,
    policyId: row.policy_id,
    targetMerkleRoot: row.target_merkle_root,
    targetPolicyHash: row.target_policy_hash,
    status: row.status,
    approvalCount: row.approval_count,
    rejectionCount: row.rejection_count,
    executedTx: row.executed_tx,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    executedAt: row.executed_at?.toISOString() ?? null,
  };
}

export async function createProposal(
  input: MultisigProposalInput,
): Promise<MultisigProposal> {
  const result = await query<ProposalRow>(
    `INSERT INTO multisig_proposals (
       operator_id, multisig_address, transaction_index, transaction_pda,
       proposal_pda, action, policy_id, target_merkle_root, target_policy_hash,
       status, created_by
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
     ON CONFLICT (multisig_address, transaction_index) DO UPDATE SET
       proposal_pda      = EXCLUDED.proposal_pda,
       action            = EXCLUDED.action,
       policy_id         = COALESCE(EXCLUDED.policy_id, multisig_proposals.policy_id),
       target_merkle_root = COALESCE(EXCLUDED.target_merkle_root, multisig_proposals.target_merkle_root),
       target_policy_hash = COALESCE(EXCLUDED.target_policy_hash, multisig_proposals.target_policy_hash),
       updated_at        = NOW()
     RETURNING *;`,
    [
      input.operatorId,
      input.multisigAddress,
      input.transactionIndex,
      input.transactionPda,
      input.proposalPda ?? null,
      input.action,
      input.policyId ?? null,
      input.targetMerkleRoot ?? null,
      input.targetPolicyHash ?? null,
      input.createdBy,
    ],
  );
  return rowToProposal(result.rows[0]);
}

export async function listProposalsForOperator(
  operatorId: string,
  options: {
    readonly status?: MultisigProposalStatus | 'all';
    readonly limit?: number;
  } = {},
): Promise<readonly MultisigProposal[]> {
  const { status, limit = 50 } = options;
  const params: unknown[] = [operatorId];
  let where = 'WHERE operator_id = $1';
  if (status && status !== 'all') {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  params.push(Math.min(Math.max(limit, 1), 200));
  const result = await query<ProposalRow>(
    `SELECT * FROM multisig_proposals
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(rowToProposal);
}

export async function getProposal(id: string): Promise<MultisigProposal | null> {
  const result = await query<ProposalRow>(
    'SELECT * FROM multisig_proposals WHERE id = $1',
    [id],
  );
  if (result.rows.length === 0) return null;
  return rowToProposal(result.rows[0]);
}

interface UpdateStatusArgs {
  readonly id: string;
  readonly status: MultisigProposalStatus;
  readonly approvalCount?: number;
  readonly rejectionCount?: number;
  readonly executedTx?: string;
}

export async function updateProposalStatus(
  args: UpdateStatusArgs,
): Promise<MultisigProposal | null> {
  const result = await query<ProposalRow>(
    `UPDATE multisig_proposals
     SET status          = $2::varchar,
         approval_count  = COALESCE($3::int, approval_count),
         rejection_count = COALESCE($4::int, rejection_count),
         executed_tx     = COALESCE($5::varchar, executed_tx),
         executed_at     = CASE WHEN $2::varchar = 'executed' THEN NOW() ELSE executed_at END,
         updated_at      = NOW()
     WHERE id = $1::uuid
     RETURNING *;`,
    [
      args.id,
      args.status,
      args.approvalCount ?? null,
      args.rejectionCount ?? null,
      args.executedTx ?? null,
    ],
  );
  if (result.rows.length === 0) return null;
  return rowToProposal(result.rows[0]);
}

export async function listPendingForPolicy(
  policyId: string,
): Promise<readonly MultisigProposal[]> {
  const result = await query<ProposalRow>(
    `SELECT * FROM multisig_proposals
     WHERE policy_id = $1
       AND status IN ('pending','approved')
     ORDER BY created_at DESC
     LIMIT 10`,
    [policyId],
  );
  return result.rows.map(rowToProposal);
}
