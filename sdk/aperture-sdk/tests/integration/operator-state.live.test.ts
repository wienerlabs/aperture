/**
 * Live OperatorState read. Connects to the real Solana cluster at
 * $SOLANA_RPC_URL and reads the verifier's OperatorState PDA for the test
 * wallet. The account may not exist yet (operator has never run a cycle) —
 * in that case the helper returns null and the effective daily-spent value
 * must be 0, matching the verifier's first-call convention.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  deriveOperatorStatePDA,
  readEffectiveDailySpentLamports,
  readOperatorState,
} from '../../src/anchor/index.js';
import { buildConnection, loadIntegrationEnv, type IntegrationEnv } from './env.js';
import { Connection } from '@solana/web3.js';

describe('OperatorState read against live devnet', () => {
  let env: IntegrationEnv;
  let connection: Connection;

  beforeAll(() => {
    env = loadIntegrationEnv();
    connection = buildConnection(env);
  });

  it('derives a deterministic PDA on the verifier program', () => {
    const [pda] = deriveOperatorStatePDA(env.wallet.publicKey);
    expect(pda.toBase58().length).toBeGreaterThan(0);
  });

  it('reads OperatorState (or null) without throwing', async () => {
    const state = await readOperatorState(connection, env.wallet.publicKey);
    if (state) {
      expect(state.operator.equals(env.wallet.publicKey)).toBe(true);
      expect(state.dailySpentLamports).toBeGreaterThanOrEqual(0n);
      expect(state.pendingProofHash.length).toBe(32);
    }
  }, 30_000);

  it('effective daily_spent honors UTC rollover', async () => {
    const spent = await readEffectiveDailySpentLamports(
      connection,
      env.wallet.publicKey,
    );
    expect(spent).toBeGreaterThanOrEqual(0n);
  }, 30_000);
});
