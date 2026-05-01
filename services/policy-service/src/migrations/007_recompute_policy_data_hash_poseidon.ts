import type pg from 'pg';
import type { Policy } from '@aperture/types';
import { computePolicyDataHash } from '../utils/merkle.js';

/**
 * Replaces every policy_data_hash_hex written by migration 006 (which used
 * SHA-256) with the new Poseidon-based commitment that the upcoming ZK circuit
 * (Adım 4b) will reproduce internally and the verifier (Adım 5) will compare
 * against on-chain.
 *
 * merkle_root_hex stays SHA-256 — it serves a different purpose (selective
 * disclosure to off-chain auditors) and never enters the circuit.
 *
 * Side effect: every policy whose old commitment was already 'registered'
 * on Solana now has a stale on-chain PolicyAccount.policy_data_hash. We flip
 * those rows to 'pending' so the dashboard prompts the operator to re-anchor
 * via the Adım 2 flow. The on-chain SHA-256 value remains in the
 * PolicyAccount until the operator signs an update_policy transaction; the
 * Verifier sıkılaştırma in Adım 5 will then refuse proofs whose
 * policy_data_hash does not match the new on-chain Poseidon value, so any
 * gap between this migration and re-anchoring fails closed.
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
    time_restrictions:
      typeof row.time_restrictions === 'string'
        ? JSON.parse(row.time_restrictions)
        : (row.time_restrictions as Policy['time_restrictions']),
    token_whitelist: row.token_whitelist,
    is_active: row.is_active,
    version: row.version,
    aip_agent_did: row.aip_agent_did,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
     FROM policies`
  );

  for (const row of result.rows) {
    const policy = rowToPolicy(row);
    let newHash: string;
    try {
      newHash = await computePolicyDataHash(policy);
    } catch (err) {
      // A policy with non-UTC time restrictions cannot be hashed by the MVP
      // commitment. Mark it failed and continue — the operator must edit the
      // policy to a supported configuration before they can anchor it.
      const message = err instanceof Error ? err.message : String(err);
      await client.query(
        `UPDATE policies
           SET onchain_status = 'failed',
               onchain_last_error = $1
         WHERE id = $2`,
        [`Adım 4a Poseidon recompute failed: ${message}`, row.id]
      );
      continue;
    }

    await client.query(
      `UPDATE policies
         SET policy_data_hash_hex = $1,
             onchain_status = CASE
               WHEN onchain_status = 'registered' THEN 'pending'
               ELSE onchain_status
             END,
             onchain_last_error = NULL
       WHERE id = $2`,
      [newHash, row.id]
    );
  }
}

export async function down(): Promise<void> {
  // No safe down path. Reverting the commitment to SHA-256 would not undo the
  // 'registered' -> 'pending' flip, and the prior SHA-256 value is no longer
  // canonical now that the circuit consumes Poseidon. Leave forward-only.
  return;
}
