/**
 * End-to-end MPP cycle. Goes through:
 *   - GET the MPP-protected endpoint, parse the 402 challenge with a Stripe
 *     PaymentIntent ID
 *   - Confirm the PaymentIntent off_session via the live Stripe API
 *   - Poll compliance-api for the webhook-persisted Poseidon receipt
 *   - POST to the live prover-service with stripe_receipt_hash bound
 *   - Submit Ed25519 verify + verify_mpp_payment_proof to the verifier
 *   - Retry the GET with x-mpp-credential and x-aperture-proof-record headers
 *
 * Gated on APERTURE_TEST_MPP_ENABLED=1 since MPP requires a working Stripe
 * webhook forwarder and saved customer + payment method.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { ApertureClient } from '../../src/index.js';
import { buildConnection, loadIntegrationEnv, type IntegrationEnv } from './env.js';

const enabled = process.env.APERTURE_TEST_MPP_ENABLED === '1';

describe.skipIf(!enabled)('MPP cycle end-to-end on devnet + Stripe', () => {
  let env: IntegrationEnv;
  let client: ApertureClient;

  beforeAll(() => {
    env = loadIntegrationEnv();
    if (!env.mpp.stripeSecretKey) {
      throw new Error(
        'APERTURE_TEST_MPP_ENABLED=1 requires STRIPE_SECRET_KEY to be set',
      );
    }
    client = new ApertureClient({
      wallet: env.wallet,
      connection: buildConnection(env),
      policyServiceUrl: env.policyServiceUrl,
      proverServiceUrl: env.proverServiceUrl,
      complianceApiUrl: env.complianceApiUrl,
      stripeSecretKey: env.mpp.stripeSecretKey,
    });
  });

  it('confirms a Stripe PaymentIntent, anchors the receipt on-chain, and unlocks the resource', async () => {
    const policy = await client.loadActivePolicy();
    const endpoint = `${env.complianceApiUrl}/api/v1/compliance/mpp-protected-service?operator_id=${env.operatorId}`;
    const result = await client.payMpp(endpoint, policy);

    expect(result.txSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(result.proofRecordPda).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(result.paymentIntentId.startsWith('pi_')).toBe(true);
    expect(result.amountCents).toBeGreaterThan(0);
    expect(result.response.ok).toBe(true);
  }, 600_000);
});
