import { Connection, Keypair } from '@solana/web3.js';

/**
 * Integration-test environment loader. Every test in tests/integration/ hits
 * REAL services and the REAL Solana devnet. Missing env vars are a hard
 * failure — these tests are not allowed to fall back to mocks.
 *
 * Required env vars before running `npm run test:integration`:
 *   SOLANA_RPC_URL                  e.g. https://api.devnet.solana.com
 *   POLICY_SERVICE_URL              e.g. http://localhost:3001
 *   PROVER_SERVICE_URL              e.g. http://localhost:3003
 *   COMPLIANCE_API_URL              e.g. http://localhost:3002
 *   AGENT_WALLET_PRIVATE_KEY        base58 or JSON-array private key
 *                                   (operator must already have an anchored
 *                                   policy on-chain — provision from the
 *                                   Aperture dashboard once before running).
 *
 * Optional:
 *   APERTURE_TEST_X402_ENDPOINT     full URL the x402 test should hit.
 *                                   Defaults to the compliance-api's built-in
 *                                   protected-report endpoint.
 *   APERTURE_TEST_MPP_ENABLED       set to "1" to also exercise the MPP flow
 *                                   (requires STRIPE_SECRET_KEY and a saved
 *                                   Stripe customer + payment method for the
 *                                   operator).
 *   STRIPE_SECRET_KEY               required when APERTURE_TEST_MPP_ENABLED=1
 */
export interface IntegrationEnv {
  readonly solanaRpcUrl: string;
  readonly policyServiceUrl: string;
  readonly proverServiceUrl: string;
  readonly complianceApiUrl: string;
  readonly wallet: Keypair;
  readonly operatorId: string;
  readonly x402Endpoint: string;
  readonly mpp: { readonly enabled: boolean; readonly stripeSecretKey: string | null };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Integration tests require env var ${name}. ` +
        `See sdk/aperture-sdk/tests/integration/env.ts for the full list. ` +
        `These tests hit real services + Solana devnet — there is no mock fallback.`,
    );
  }
  return value;
}

function decodeBase58(raw: string): Uint8Array {
  const ALPHABET =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = 0n;
  for (const ch of raw) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`AGENT_WALLET_PRIVATE_KEY contains invalid base58 char: ${ch}`);
    }
    num = num * 58n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(128, '0');
  const matches = hex.match(/.{2}/g);
  if (!matches) throw new Error('AGENT_WALLET_PRIVATE_KEY decoded to empty bytes');
  return new Uint8Array(matches.map((b) => parseInt(b, 16)));
}

function loadWallet(): Keypair {
  const raw = required('AGENT_WALLET_PRIVATE_KEY').trim();
  let bytes: Uint8Array;
  if (raw.startsWith('[')) {
    bytes = new Uint8Array(JSON.parse(raw) as number[]);
  } else {
    bytes = decodeBase58(raw);
  }
  return Keypair.fromSecretKey(bytes);
}

export function loadIntegrationEnv(): IntegrationEnv {
  const wallet = loadWallet();
  const complianceApiUrl = required('COMPLIANCE_API_URL').replace(/\/$/, '');
  const operatorId = wallet.publicKey.toBase58();
  const mppEnabled = process.env.APERTURE_TEST_MPP_ENABLED === '1';
  const stripeSecretKey = mppEnabled ? required('STRIPE_SECRET_KEY') : null;
  return {
    solanaRpcUrl: required('SOLANA_RPC_URL'),
    policyServiceUrl: required('POLICY_SERVICE_URL').replace(/\/$/, ''),
    proverServiceUrl: required('PROVER_SERVICE_URL').replace(/\/$/, ''),
    complianceApiUrl,
    wallet,
    operatorId,
    x402Endpoint:
      process.env.APERTURE_TEST_X402_ENDPOINT ??
      `${complianceApiUrl}/api/v1/compliance/protected-report?operator_id=${operatorId}`,
    mpp: { enabled: mppEnabled, stripeSecretKey },
  };
}

export function buildConnection(env: IntegrationEnv): Connection {
  return new Connection(env.solanaRpcUrl, 'confirmed');
}
