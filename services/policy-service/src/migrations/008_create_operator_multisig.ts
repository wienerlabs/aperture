import type pg from 'pg';

/**
 * Adds the off-chain ledger for Squads V4 multisig bindings and proposals.
 *
 * Multisig binding state lives on-chain in the OperatorAccount.multisig
 * field, but the dashboard surfaces a richer view: members, threshold,
 * vault index and a human-readable label. Caching that metadata in
 * Postgres lets the UI render binding cards without round-tripping to
 * the Solana RPC on every request.
 *
 * The proposals table is a thin index over Squads' own transaction
 * accounts; we don't try to mirror the entire Squads state, only the
 * minimum needed to surface "this policy update is awaiting multisig
 * approval" in the policies grid.
 */
export async function up(client: pg.PoolClient): Promise<void> {
  await client.query(`
    -- Squads V4 multisig bindings, one per operator. The on-chain truth is
    -- OperatorAccount.multisig. This row is a cache + audit log of every
    -- bind/unbind action so we can render a stable UI without hitting RPC.
    CREATE TABLE IF NOT EXISTS operator_multisig (
      operator_id            VARCHAR(64)  PRIMARY KEY,
      multisig_address       VARCHAR(64)  NOT NULL,
      vault_index            SMALLINT     NOT NULL DEFAULT 0,
      vault_pda              VARCHAR(64)  NOT NULL,
      threshold              INTEGER      NOT NULL,
      member_count           INTEGER      NOT NULL,
      members                JSONB        NOT NULL DEFAULT '[]'::jsonb,
      label                  VARCHAR(255),
      bind_tx_signature      VARCHAR(128),
      last_synced_at         TIMESTAMPTZ,
      bound_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      CONSTRAINT operator_multisig_threshold_positive CHECK (threshold > 0),
      CONSTRAINT operator_multisig_vault_index_range  CHECK (vault_index >= 0 AND vault_index < 256)
    );

    CREATE INDEX IF NOT EXISTS idx_operator_multisig_address
      ON operator_multisig(multisig_address);

    -- Append-only audit trail of every bind / unbind / sync the operator
    -- triggered. Helps reconstruct who did what when an auditor asks.
    CREATE TABLE IF NOT EXISTS operator_multisig_audit (
      id                SERIAL       PRIMARY KEY,
      operator_id       VARCHAR(64)  NOT NULL,
      action            VARCHAR(20)  NOT NULL CHECK (action IN ('bind','unbind','sync','rotate')),
      multisig_address  VARCHAR(64),
      vault_index       SMALLINT,
      tx_signature      VARCHAR(128),
      payload           JSONB        NOT NULL DEFAULT '{}'::jsonb,
      actor             VARCHAR(64)  NOT NULL,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_operator_multisig_audit_operator
      ON operator_multisig_audit(operator_id, created_at DESC);

    -- Off-chain index of multisig proposals tied to Aperture policy updates.
    -- Squads owns the canonical state; we only track enough to render UI.
    CREATE TABLE IF NOT EXISTS multisig_proposals (
      id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
      operator_id         VARCHAR(64)  NOT NULL,
      multisig_address    VARCHAR(64)  NOT NULL,
      transaction_index   BIGINT       NOT NULL,
      transaction_pda     VARCHAR(64)  NOT NULL,
      proposal_pda        VARCHAR(64),
      action              VARCHAR(20)  NOT NULL
        CHECK (action IN ('register_policy','update_policy','deactivate_policy','rotate_multisig','custom')),
      policy_id           UUID,
      target_merkle_root  CHAR(64),
      target_policy_hash  CHAR(64),
      status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','approved','executed','rejected','cancelled','expired')),
      approval_count      INTEGER      NOT NULL DEFAULT 0,
      rejection_count     INTEGER      NOT NULL DEFAULT 0,
      executed_tx         VARCHAR(128),
      created_by          VARCHAR(64)  NOT NULL,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      executed_at         TIMESTAMPTZ,
      CONSTRAINT multisig_proposals_unique_tx
        UNIQUE (multisig_address, transaction_index)
    );

    CREATE INDEX IF NOT EXISTS idx_multisig_proposals_operator
      ON multisig_proposals(operator_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_multisig_proposals_status
      ON multisig_proposals(status)
      WHERE status IN ('pending','approved');

    CREATE INDEX IF NOT EXISTS idx_multisig_proposals_policy
      ON multisig_proposals(policy_id)
      WHERE policy_id IS NOT NULL;
  `);
}

export async function down(client: pg.PoolClient): Promise<void> {
  await client.query(`
    DROP INDEX IF EXISTS idx_multisig_proposals_policy;
    DROP INDEX IF EXISTS idx_multisig_proposals_status;
    DROP INDEX IF EXISTS idx_multisig_proposals_operator;
    DROP TABLE  IF EXISTS multisig_proposals;
    DROP INDEX IF EXISTS idx_operator_multisig_audit_operator;
    DROP TABLE  IF EXISTS operator_multisig_audit;
    DROP INDEX IF EXISTS idx_operator_multisig_address;
    DROP TABLE  IF EXISTS operator_multisig;
  `);
}
