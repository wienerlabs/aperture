import { getClient, closePool } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import * as migration001 from './001_create_policies.js';
import * as migration002 from './002_create_users.js';
import * as migration003 from './003_create_api_keys.js';
import * as migration004 from './004_add_aip_did.js';
import * as migration005 from './005_add_onchain_fields.js';
import * as migration006 from './006_backfill_onchain_commitments.js';
import * as migration007 from './007_recompute_policy_data_hash_poseidon.js';

interface Migration {
  name: string;
  up: (client: import('pg').PoolClient) => Promise<void>;
  down: (client: import('pg').PoolClient) => Promise<void>;
}

const migrations: Migration[] = [
  { name: '001_create_policies', ...migration001 },
  { name: '002_create_users', ...migration002 },
  { name: '003_create_api_keys', ...migration003 },
  { name: '004_add_aip_did', ...migration004 },
  { name: '005_add_onchain_fields', ...migration005 },
  { name: '006_backfill_onchain_commitments', ...migration006 },
  { name: '007_recompute_policy_data_hash_poseidon', ...migration007 },
];

async function rollbackLastMigration(): Promise<void> {
  const client = await getClient();
  try {
    const result = await client.query<{ name: string }>(
      'SELECT name FROM migrations ORDER BY id DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      logger.info('No migrations to rollback');
      return;
    }

    const lastMigration = result.rows[0].name;
    const migration = migrations.find((m) => m.name === lastMigration);

    if (!migration) {
      throw new Error(`Migration not found: ${lastMigration}`);
    }

    logger.info(`Rolling back migration: ${lastMigration}`);
    await client.query('BEGIN');
    try {
      await migration.down(client);
      await client.query('DELETE FROM migrations WHERE name = $1', [lastMigration]);
      await client.query('COMMIT');
      logger.info(`Migration rolled back successfully: ${lastMigration}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await closePool();
  }
}

rollbackLastMigration().catch((error) => {
  console.error('Rollback failed:', error);
  process.exit(1);
});
