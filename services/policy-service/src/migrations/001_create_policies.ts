import type pg from 'pg';

export async function up(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

    CREATE TABLE IF NOT EXISTS policies (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      operator_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      max_daily_spend NUMERIC(20, 6) NOT NULL CHECK (max_daily_spend > 0),
      max_per_transaction NUMERIC(20, 6) NOT NULL CHECK (max_per_transaction > 0),
      allowed_endpoint_categories TEXT[] NOT NULL DEFAULT '{}',
      blocked_addresses TEXT[] NOT NULL DEFAULT '{}',
      time_restrictions JSONB NOT NULL DEFAULT '[]',
      token_whitelist TEXT[] NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT true,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_policies_operator_id ON policies(operator_id);
    CREATE INDEX idx_policies_is_active ON policies(is_active);
    CREATE INDEX idx_policies_operator_active ON policies(operator_id, is_active);

    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function down(client: pg.PoolClient): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS policies;
    DROP TABLE IF EXISTS migrations;
  `);
}
