/**
 * Live prover-service test. Hits the real Circom + snarkjs Groth16 prover at
 * $PROVER_SERVICE_URL with a fully-formed witness. The proof returned must
 * decode into 64+128+64 bytes of Groth16 + 10 base64 32-byte public inputs
 * the on-chain verifier will accept.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { PolicyClient, ProverClient } from '../../src/index.js';
import { base64ToBytes } from '../../src/util/base.js';
import { PAYMENT_PUBLIC_INPUTS } from '../../src/anchor/index.js';
import { loadIntegrationEnv, type IntegrationEnv } from './env.js';

describe('ProverClient against live prover-service', () => {
  let env: IntegrationEnv;
  let prover: ProverClient;
  let policy: PolicyClient;

  beforeAll(async () => {
    env = loadIntegrationEnv();
    prover = new ProverClient({ baseUrl: env.proverServiceUrl });
    policy = new PolicyClient({ baseUrl: env.policyServiceUrl });
  });

  it('healthCheck succeeds', async () => {
    expect(await prover.healthCheck()).toBe(true);
  }, 10_000);

  it('generates a Groth16 proof bound to the operator policy', async () => {
    const loaded = await policy.loadActivePolicy(env.operatorId);
    const mint = loaded.tokenWhitelist[0];
    if (!mint) {
      throw new Error(
        `Operator ${env.operatorId} has no whitelisted token mints. Add at least one to the active policy from the dashboard before running this test.`,
      );
    }
    const maxPerTx = parseInt(loaded.compiled.max_per_transaction_lamports, 10);
    const amount = Math.min(maxPerTx, 1_000_000);

    const proof = await prover.generateProof({
      compiledPolicy: loaded.compiled,
      paymentRecipient: env.operatorId,
      paymentTokenMint: mint,
      paymentAmountLamports: amount,
      paymentEndpointCategory:
        loaded.allowedCategories.find((c) => c === 'x402') ??
        loaded.allowedCategories[0],
      dailySpentBeforeLamports: 0n,
      currentUnixSeconds: Math.floor(Date.now() / 1000),
    });

    expect(proof.is_compliant).toBe(true);
    expect(base64ToBytes(proof.groth16.proof_a).length).toBe(64);
    expect(base64ToBytes(proof.groth16.proof_b).length).toBe(128);
    expect(base64ToBytes(proof.groth16.proof_c).length).toBe(64);
    expect(proof.groth16.public_inputs.length).toBe(PAYMENT_PUBLIC_INPUTS);
    for (const pi of proof.groth16.public_inputs) {
      expect(base64ToBytes(pi).length).toBe(32);
    }
    // public_inputs[0] is the is_compliant flag; the verifier rejects 0.
    expect(base64ToBytes(proof.groth16.public_inputs[0]).at(-1)).toBe(1);
  }, 300_000);
});
