/**
 * End-to-end x402 cycle. Goes through the real chain:
 *   - GET the protected endpoint, parse the 402 challenge
 *   - Read OperatorState from devnet
 *   - POST to the live prover-service for a Groth16 proof
 *   - Submit verify_payment_proof_v2_with_transfer to the verifier program
 *   - Retry the GET with the proof header and assert it unlocks
 *
 * REQUIRES that the test wallet:
 *   - has an active, on-chain-anchored policy with 'x402' in allowed categories
 *   - holds enough of the whitelisted token in its ATA to cover the challenge
 *   - has SOL for tx fees
 * AND that the recipient ATA on the challenge already exists OR the test
 * wallet can fund its creation.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { ApertureClient } from '../../src/index.js';
import { buildConnection, loadIntegrationEnv, type IntegrationEnv } from './env.js';

describe('x402 cycle end-to-end on devnet', () => {
  let env: IntegrationEnv;
  let client: ApertureClient;

  beforeAll(() => {
    env = loadIntegrationEnv();
    client = new ApertureClient({
      wallet: env.wallet,
      connection: buildConnection(env),
      policyServiceUrl: env.policyServiceUrl,
      proverServiceUrl: env.proverServiceUrl,
      complianceApiUrl: env.complianceApiUrl,
    });
  });

  it('performs verify + transfer atomically and unlocks the protected resource', async () => {
    const policy = await client.loadActivePolicy();
    const result = await client.payX402(env.x402Endpoint, policy);

    expect(result.txSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(result.proofRecordPda).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(result.amountLamports).toBeGreaterThan(0);
    expect(result.tokenMint.length).toBeGreaterThan(0);
    expect(result.response.ok).toBe(true);

    const body = await result.response.json();
    expect(body).toBeTruthy();
  }, 600_000);
});
