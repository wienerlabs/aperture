import type pg from 'pg';

/**
 * Add the on-chain commitment columns required for binding each policy to its
 * Anchor-deployed PolicyAccount in the policy-registry program. After this
 * migration:
 *   - merkle_root_hex / policy_data_hash_hex carry the deterministic 32-byte
 *     commitments that match exactly what register_policy / update_policy
 *     write into the on-chain PolicyAccount. They are filled at create/update
 *     time by the policy model.
 *   - onchain_pda is the derived PolicyAccount address, written after a
 *     successful on-chain registration so the verifier can cross-check it.
 *   - onchain_tx_signature pins the registration to a specific Solana tx,
 *     making the on-chain state auditable from the dashboard.
 *   - onchain_status drives the gate: only 'registered' policies will be
 *     accepted by the verifier downstream.
 *
 * Existing policies retain status='pending' until the dashboard re-anchors
 * them via the wallet flow introduced in Adım 2.6/2.10.
 */
export async function up(client: pg.PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE policies
      ADD COLUMN IF NOT EXISTS merkle_root_hex CHAR(64),
      ADD COLUMN IF NOT EXISTS policy_data_hash_hex CHAR(64),
      ADD COLUMN IF NOT EXISTS onchain_pda VARCHAR(64),
      ADD COLUMN IF NOT EXISTS onchain_tx_signature VARCHAR(128),
      ADD COLUMN IF NOT EXISTS onchain_status VARCHAR(20)
        NOT NULL DEFAULT 'pending'
        CHECK (onchain_status IN ('pending', 'registered', 'failed')),
      ADD COLUMN IF NOT EXISTS onchain_registered_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS onchain_last_error TEXT,
      ADD COLUMN IF NOT EXISTS onchain_version INTEGER;

    CREATE INDEX IF NOT EXISTS idx_policies_onchain_status
      ON policies(onchain_status);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_onchain_pda_unique
      ON policies(onchain_pda)
      WHERE onchain_pda IS NOT NULL;
  `);
}

export async function down(client: pg.PoolClient): Promise<void> {
  await client.query(`
    DROP INDEX IF EXISTS idx_policies_onchain_pda_unique;
    DROP INDEX IF EXISTS idx_policies_onchain_status;
    ALTER TABLE policies
      DROP COLUMN IF EXISTS onchain_version,
      DROP COLUMN IF EXISTS onchain_last_error,
      DROP COLUMN IF EXISTS onchain_registered_at,
      DROP COLUMN IF EXISTS onchain_status,
      DROP COLUMN IF EXISTS onchain_tx_signature,
      DROP COLUMN IF EXISTS onchain_pda,
      DROP COLUMN IF EXISTS policy_data_hash_hex,
      DROP COLUMN IF EXISTS merkle_root_hex;
  `);
}
