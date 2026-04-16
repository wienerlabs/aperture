import { v4 as uuidv4 } from 'uuid';
import { query, transaction } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import type { Policy, PolicyInput, PolicyUpdate, CircuitPolicyInput } from '@aperture/types';

interface PolicyRow {
  id: string;
  operator_id: string;
  name: string;
  description: string | null;
  max_daily_spend: string;
  max_per_transaction: string;
  allowed_endpoint_categories: string[];
  blocked_addresses: string[];
  time_restrictions: string;
  token_whitelist: string[];
  is_active: boolean;
  version: number;
  aip_agent_did: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToPolicy(row: PolicyRow): Policy {
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
      : row.time_restrictions,
    token_whitelist: row.token_whitelist,
    is_active: row.is_active,
    version: row.version,
    aip_agent_did: row.aip_agent_did ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createPolicy(input: PolicyInput): Promise<Policy> {
  const id = uuidv4();
  const result = await query<PolicyRow>(
    `INSERT INTO policies (id, operator_id, name, description, max_daily_spend, max_per_transaction,
       allowed_endpoint_categories, blocked_addresses, time_restrictions, token_whitelist, is_active, aip_agent_did)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     RETURNING *`,
    [
      id,
      input.operator_id,
      input.name,
      input.description ?? null,
      input.max_daily_spend,
      input.max_per_transaction,
      input.allowed_endpoint_categories,
      input.blocked_addresses,
      JSON.stringify(input.time_restrictions),
      input.token_whitelist,
      input.is_active ?? true,
      input.aip_agent_did ?? null,
    ]
  );

  logger.info('Policy created', { policy_id: id, operator_id: input.operator_id });
  return rowToPolicy(result.rows[0]);
}

export async function getPolicyById(id: string): Promise<Policy | null> {
  const result = await query<PolicyRow>(
    'SELECT * FROM policies WHERE id = $1',
    [id]
  );
  return result.rows.length > 0 ? rowToPolicy(result.rows[0]) : null;
}

export async function getPoliciesByOperator(
  operatorId: string,
  page: number,
  limit: number,
  activeOnly: boolean
): Promise<{ policies: Policy[]; total: number }> {
  const offset = (page - 1) * limit;

  const whereClause = activeOnly
    ? 'WHERE operator_id = $1 AND is_active = true'
    : 'WHERE operator_id = $1';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM policies ${whereClause}`,
    [operatorId]
  );

  const result = await query<PolicyRow>(
    `SELECT * FROM policies ${whereClause} ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [operatorId, limit, offset]
  );

  return {
    policies: result.rows.map(rowToPolicy),
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function updatePolicy(id: string, updates: PolicyUpdate): Promise<Policy | null> {
  return transaction(async (client) => {
    const existing = await client.query<PolicyRow>(
      'SELECT * FROM policies WHERE id = $1 FOR UPDATE',
      [id]
    );

    if (existing.rows.length === 0) {
      return null;
    }

    const current = existing.rows[0];
    const newVersion = current.version + 1;

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(updates.description);
    }
    if (updates.max_daily_spend !== undefined) {
      fields.push(`max_daily_spend = $${paramIndex++}`);
      values.push(updates.max_daily_spend);
    }
    if (updates.max_per_transaction !== undefined) {
      fields.push(`max_per_transaction = $${paramIndex++}`);
      values.push(updates.max_per_transaction);
    }
    if (updates.allowed_endpoint_categories !== undefined) {
      fields.push(`allowed_endpoint_categories = $${paramIndex++}`);
      values.push(updates.allowed_endpoint_categories);
    }
    if (updates.blocked_addresses !== undefined) {
      fields.push(`blocked_addresses = $${paramIndex++}`);
      values.push(updates.blocked_addresses);
    }
    if (updates.time_restrictions !== undefined) {
      fields.push(`time_restrictions = $${paramIndex++}::jsonb`);
      values.push(JSON.stringify(updates.time_restrictions));
    }
    if (updates.token_whitelist !== undefined) {
      fields.push(`token_whitelist = $${paramIndex++}`);
      values.push(updates.token_whitelist);
    }
    if (updates.is_active !== undefined) {
      fields.push(`is_active = $${paramIndex++}`);
      values.push(updates.is_active);
    }
    if (updates.aip_agent_did !== undefined) {
      fields.push(`aip_agent_did = $${paramIndex++}`);
      values.push(updates.aip_agent_did);
    }

    if (fields.length === 0) {
      return rowToPolicy(current);
    }

    fields.push(`version = $${paramIndex++}`);
    values.push(newVersion);
    fields.push(`updated_at = NOW()`);

    values.push(id);
    const result = await client.query<PolicyRow>(
      `UPDATE policies SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    logger.info('Policy updated', { policy_id: id, version: newVersion });
    return rowToPolicy(result.rows[0]);
  });
}

export async function deletePolicy(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM policies WHERE id = $1',
    [id]
  );
  if (result.rowCount && result.rowCount > 0) {
    logger.info('Policy deleted', { policy_id: id });
    return true;
  }
  return false;
}

export function compileForCircuit(policy: Policy): CircuitPolicyInput {
  const LAMPORTS_PER_UNIT = 1_000_000n;
  return {
    policy_id: policy.id,
    operator_id: policy.operator_id,
    max_daily_spend_lamports: BigInt(Math.round(policy.max_daily_spend * Number(LAMPORTS_PER_UNIT))),
    max_per_transaction_lamports: BigInt(Math.round(policy.max_per_transaction * Number(LAMPORTS_PER_UNIT))),
    allowed_endpoint_categories: policy.allowed_endpoint_categories,
    blocked_addresses: policy.blocked_addresses,
    time_restrictions: policy.time_restrictions,
    token_whitelist: policy.token_whitelist,
    version: policy.version,
    compiled_at: new Date().toISOString(),
  };
}
