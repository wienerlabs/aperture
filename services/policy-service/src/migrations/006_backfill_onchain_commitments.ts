import type pg from 'pg';
import type { Policy } from '@aperture/types';
import { computePolicyCommitments } from '../utils/merkle.js';

/**
 * Backfills merkle_root_hex and policy_data_hash_hex for every policy created
 * before migration 005 added the columns. Without this pass, /onchain-payload
 * returns a 500 because those columns are required to be non-null at signing
 * time.
 *
 * Touches NOT TOUCH onchain_status, onchain_pda, onchain_tx_signature, or
 * onchain_version: rows stay in 'pending' so the dashboard prompts the
 * operator to anchor them via the wallet flow. We never fabricate an
 * on-chain registration.
 */
interface RawRow {
  id: string;
  operator_id: string;
  name: string;
  description: string | null;
  max_daily_spend: string;
  max_per_transaction: string;
  allowed_endpoint_categories: string[];
  blocked_addresses: string[];
  time_restrictions: unknown;
  token_whitelist: string[];
  is_active: boolean;
  version: number;
  aip_agent_did: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToPolicy(row: RawRow): Policy {
  return {
    id: row.id,
    operator_id: row.operator_id,
    name: row.name,
    description: row.description,
    max_daily_spend: parseFloat(row.max_daily_spend),
    max_per_transaction: parseFloat(row.max_per_transaction),
    allowed_endpoint_categories: row.allowed_endpoint_categories,
    blocked_addresses: row.blocked_addresses,
    time_restrictions: typeof row.time_restrictions === 'string'
      ? JSON.parse(row.time_restrictions)
      : (row.time_restrictions as Policy['time_restrictions']),
    token_whitelist: row.token_whitelist,
    is_active: row.is_active,
    version: row.version,
    aip_agent_did: row.aip_agent_did,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Backfill targets — these are what the migration computes and writes.
    merkle_root_hex: null,
    policy_data_hash_hex: null,
    onchain_pda: null,
    onchain_tx_signature: null,
    onchain_status: 'pending',
    onchain_registered_at: null,
    onchain_last_error: null,
    onchain_version: null,
  };
}

export async function up(client: pg.PoolClient): Promise<void> {
  const result = await client.query<RawRow>(
    `SELECT id, operator_id, name, description, max_daily_spend, max_per_transaction,
            allowed_endpoint_categories, blocked_addresses, time_restrictions,
            token_whitelist, is_active, version, aip_agent_did, created_at, updated_at
     FROM policies
     WHERE merkle_root_hex IS NULL OR policy_data_hash_hex IS NULL`
  );

  for (const row of result.rows) {
    const policy = rowToPolicy(row);
    const { merkleRootHex, policyDataHashHex } = await computePolicyCommitments(policy);

    await client.query(
      `UPDATE policies
         SET merkle_root_hex = $1, policy_data_hash_hex = $2
       WHERE id = $3`,
      [merkleRootHex, policyDataHashHex, row.id]
    );
  }
}

export async function down(): Promise<void> {
  // Backfilled values cannot be safely reverted to NULL — that would break
  // every signed-and-confirmed registration that already references these
  // commitments on-chain. Leave the data in place; rolling back the schema
  // happens via migration 005 down.
  return;
}
