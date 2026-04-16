import type pg from 'pg';

export async function up(client: pg.PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE policies ADD COLUMN IF NOT EXISTS aip_agent_did VARCHAR(255) DEFAULT NULL;

    CREATE INDEX IF NOT EXISTS idx_policies_aip_agent_did ON policies(aip_agent_did)
      WHERE aip_agent_did IS NOT NULL;
  `);
}

export async function down(client: pg.PoolClient): Promise<void> {
  await client.query(`
    DROP INDEX IF EXISTS idx_policies_aip_agent_did;
    ALTER TABLE policies DROP COLUMN IF EXISTS aip_agent_did;
  `);
}
