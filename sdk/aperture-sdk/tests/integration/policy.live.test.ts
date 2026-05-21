/**
 * Live policy-service test. Hits the real REST API at $POLICY_SERVICE_URL and
 * requires the operator (wallet pubkey) to already have an active, on-chain-
 * anchored policy. There is no mock fallback — set up the policy from the
 * Aperture dashboard before running this suite.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { PolicyClient } from '../../src/index.js';
import { loadIntegrationEnv, type IntegrationEnv } from './env.js';

describe('PolicyClient against live policy-service', () => {
  let env: IntegrationEnv;
  let client: PolicyClient;

  beforeAll(() => {
    env = loadIntegrationEnv();
    client = new PolicyClient({ baseUrl: env.policyServiceUrl });
  });

  it('loads the operator active policy with on-chain anchor', async () => {
    const policy = await client.loadActivePolicy(env.operatorId);
    expect(policy.id).toBeTruthy();
    expect(policy.onchainPda).toBeTruthy();
    expect(policy.compiled.policy_id).toBe(policy.id);
    expect(policy.compiled.operator_id).toBe(env.operatorId);
    expect(policy.tokenWhitelist.length).toBeGreaterThan(0);
    expect(parseInt(policy.compiled.max_per_transaction_lamports, 10)).toBe(
      policy.maxPerTxLamports,
    );
  }, 30_000);

  it('compile endpoint returns integer-lamport fields', async () => {
    const policy = await client.loadActivePolicy(env.operatorId);
    const compiled = await client.compile(policy.id);
    expect(compiled.max_daily_spend_lamports).toMatch(/^\d+$/);
    expect(compiled.max_per_transaction_lamports).toMatch(/^\d+$/);
  }, 30_000);
});
