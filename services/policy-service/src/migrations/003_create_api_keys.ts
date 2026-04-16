import type pg from 'pg';

export async function up(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      prefix VARCHAR(16) NOT NULL,
      key_hash CHAR(64) NOT NULL UNIQUE,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_api_keys_user ON api_keys(user_id) WHERE revoked_at IS NULL;
    CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;
  `);
}

export async function down(client: pg.PoolClient): Promise<void> {
  await client.query('DROP TABLE IF EXISTS api_keys;');
}
