import { query, transaction } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import type {
  MultisigBinding,
  MultisigBindingInput,
  MultisigMember,
  MultisigAuditAction,
  MultisigAuditEntry,
} from '@aperture/types';

interface OperatorMultisigRow {
  operator_id: string;
  multisig_address: string;
  vault_index: number;
  vault_pda: string;
  threshold: number;
  member_count: number;
  members: MultisigMember[];
  label: string | null;
  bind_tx_signature: string | null;
  last_synced_at: Date | null;
  bound_at: Date;
  created_at: Date;
  updated_at: Date;
}

interface OperatorMultisigAuditRow {
  id: number;
  operator_id: string;
  action: MultisigAuditAction;
  multisig_address: string | null;
  vault_index: number | null;
  tx_signature: string | null;
  payload: Record<string, unknown>;
  actor: string;
  created_at: Date;
}

function rowToBinding(row: OperatorMultisigRow): MultisigBinding {
  return {
    operatorId: row.operator_id,
    multisigAddress: row.multisig_address,
    vaultIndex: row.vault_index,
    vaultPda: row.vault_pda,
    threshold: row.threshold,
    memberCount: row.member_count,
    members: row.members,
    label: row.label,
    bindTxSignature: row.bind_tx_signature,
    lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
    boundAt: row.bound_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToAudit(row: OperatorMultisigAuditRow): MultisigAuditEntry {
  return {
    id: row.id,
    operatorId: row.operator_id,
    action: row.action,
    multisigAddress: row.multisig_address,
    vaultIndex: row.vault_index,
    txSignature: row.tx_signature,
    payload: row.payload,
    actor: row.actor,
    createdAt: row.created_at.toISOString(),
  };
}

interface UpsertBindingArgs extends MultisigBindingInput {
  readonly vaultPda: string;
  readonly threshold: number;
  readonly memberCount: number;
  readonly members: readonly MultisigMember[];
  readonly actor: string;
}

/**
 * Upsert a binding row. The on-chain truth is the operator's multisig
 * field; this row caches the metadata so the dashboard can render members
 * + threshold without an extra RPC round trip on every paint.
 */
export async function upsertBinding(args: UpsertBindingArgs): Promise<MultisigBinding> {
  return transaction(async (client) => {
    const result = await client.query<OperatorMultisigRow>(
      `
      INSERT INTO operator_multisig (
        operator_id, multisig_address, vault_index, vault_pda, threshold,
        member_count, members, label, bind_tx_signature, last_synced_at,
        bound_at, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,NOW(),NOW(),NOW(),NOW())
      ON CONFLICT (operator_id) DO UPDATE SET
        multisig_address = EXCLUDED.multisig_address,
        vault_index      = EXCLUDED.vault_index,
        vault_pda        = EXCLUDED.vault_pda,
        threshold        = EXCLUDED.threshold,
        member_count     = EXCLUDED.member_count,
        members          = EXCLUDED.members,
        label            = COALESCE(EXCLUDED.label, operator_multisig.label),
        bind_tx_signature = COALESCE(EXCLUDED.bind_tx_signature, operator_multisig.bind_tx_signature),
        last_synced_at   = NOW(),
        updated_at       = NOW()
      RETURNING *;
      `,
      [
        args.operatorId,
        args.multisigAddress,
        args.vaultIndex,
        args.vaultPda,
        args.threshold,
        args.memberCount,
        JSON.stringify(args.members),
        args.label ?? null,
        args.bindTxSignature ?? null,
      ],
    );

    await client.query(
      `INSERT INTO operator_multisig_audit
        (operator_id, action, multisig_address, vault_index, tx_signature, payload, actor)
       VALUES ($1,'bind',$2,$3,$4,$5::jsonb,$6)`,
      [
        args.operatorId,
        args.multisigAddress,
        args.vaultIndex,
        args.bindTxSignature ?? null,
        JSON.stringify({ threshold: args.threshold, memberCount: args.memberCount }),
        args.actor,
      ],
    );

    return rowToBinding(result.rows[0]);
  });
}

interface SyncSnapshotArgs {
  readonly operatorId: string;
  readonly multisigAddress: string;
  readonly vaultIndex: number;
  readonly vaultPda: string;
  readonly threshold: number;
  readonly members: readonly MultisigMember[];
  readonly actor: string;
}

/**
 * Refresh the cached binding from a freshly fetched on-chain snapshot. No
 * audit-log row for plain syncs to keep the table lean — only material
 * changes (bind / unbind / rotate) are recorded.
 */
export async function syncSnapshot(args: SyncSnapshotArgs): Promise<MultisigBinding> {
  return transaction(async (client) => {
    const result = await client.query<OperatorMultisigRow>(
      `
      UPDATE operator_multisig
      SET threshold      = $2,
          member_count   = $3,
          members        = $4::jsonb,
          last_synced_at = NOW(),
          updated_at     = NOW()
      WHERE operator_id = $1
      RETURNING *;
      `,
      [
        args.operatorId,
        args.threshold,
        args.members.length,
        JSON.stringify(args.members),
      ],
    );

    if (result.rowCount === 0) {
      throw new Error(`No binding found for operator ${args.operatorId}`);
    }

    await client.query(
      `INSERT INTO operator_multisig_audit
        (operator_id, action, multisig_address, vault_index, payload, actor)
       VALUES ($1,'sync',$2,$3,$4::jsonb,$5)`,
      [
        args.operatorId,
        args.multisigAddress,
        args.vaultIndex,
        JSON.stringify({ threshold: args.threshold, memberCount: args.members.length }),
        args.actor,
      ],
    );

    return rowToBinding(result.rows[0]);
  });
}

export async function getBinding(
  operatorId: string,
): Promise<MultisigBinding | null> {
  const result = await query<OperatorMultisigRow>(
    'SELECT * FROM operator_multisig WHERE operator_id = $1',
    [operatorId],
  );
  if (result.rows.length === 0) return null;
  return rowToBinding(result.rows[0]);
}

export async function deleteBinding(
  operatorId: string,
  actor: string,
): Promise<MultisigBinding | null> {
  return transaction(async (client) => {
    const existing = await client.query<OperatorMultisigRow>(
      'SELECT * FROM operator_multisig WHERE operator_id = $1',
      [operatorId],
    );
    if (existing.rowCount === 0) return null;
    const row = existing.rows[0];

    await client.query('DELETE FROM operator_multisig WHERE operator_id = $1', [
      operatorId,
    ]);

    await client.query(
      `INSERT INTO operator_multisig_audit
        (operator_id, action, multisig_address, vault_index, payload, actor)
       VALUES ($1,'unbind',$2,$3,$4::jsonb,$5)`,
      [
        operatorId,
        row.multisig_address,
        row.vault_index,
        JSON.stringify({ priorThreshold: row.threshold, priorMemberCount: row.member_count }),
        actor,
      ],
    );

    logger.info('Removed multisig binding', {
      operatorId,
      multisigAddress: row.multisig_address,
    });

    return rowToBinding(row);
  });
}

export async function listAudit(
  operatorId: string,
  limit = 50,
): Promise<readonly MultisigAuditEntry[]> {
  const result = await query<OperatorMultisigAuditRow>(
    `SELECT * FROM operator_multisig_audit
     WHERE operator_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [operatorId, Math.min(Math.max(limit, 1), 200)],
  );
  return result.rows.map(rowToAudit);
}
