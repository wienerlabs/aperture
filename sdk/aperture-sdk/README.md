# @aperturerwa/sdk

Production-ready TypeScript SDK that lets any AI agent integrate with Aperture end-to-end, **without ever touching the dashboard**. One package gives you:

- Operator + policy onboarding (initialize_operator + register_policy on Solana).
- Policy CRUD against the policy-service.
- Circom + Groth16 ZK proof generation via the prover-service.
- Atomic on-chain verify + transfer for x402 payments.
- Stripe off_session + on-chain Ed25519 attestation for MPP payments.
- Automatic proof-record + Light Protocol compressed attestation submission.
- Batch attestation rollups anchored on Solana.
- Audit links the Aperture dashboard renders, plus Solana Explorer URLs.

## Install

```bash
npm install @aperturerwa/sdk @solana/web3.js @solana/spl-token
```

## Hosted backend

The SDK talks to three Aperture backend services. You can either point at the publicly hosted Wiener Labs cluster (recommended for quick start) or stand up your own copy via `docker compose up` from this repository.

```ts
const APERTURE_HOSTED = {
  policyServiceUrl: 'https://policy-server-production.up.railway.app',
  proverServiceUrl: 'https://prover-service-production-e486.up.railway.app',
  complianceApiUrl: 'https://compliance-api-production-21f4.up.railway.app',
};
```

Both options share the same Solana devnet program IDs, so policies anchored against the hosted stack are visible on Solana regardless of which deployment you use to view them.

## 60-second tour

```ts
import { ApertureClient } from '@aperturerwa/sdk';
import { Keypair } from '@solana/web3.js';

const client = new ApertureClient({
  wallet: Keypair.fromSecretKey(/* your private key bytes */),
  rpcUrl: 'https://api.devnet.solana.com',
  policyServiceUrl: 'https://policy-server-production.up.railway.app',
  proverServiceUrl: 'https://prover-service-production-e486.up.railway.app',
  complianceApiUrl: 'https://compliance-api-production-21f4.up.railway.app',
  // Optional. If you host your own Aperture dashboard (e.g. self-hosted
  // Next.js app from this repo), pass its public URL so `client.audit.*`
  // helpers produce shareable audit links. Omit to fall back to
  // Solana Explorer transaction URLs only.
  // dashboardUrl: 'https://your-aperture-dashboard.example.com',
  // MPP only:
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
});

// 1. Onboard a brand new operator + policy (single call, on-chain anchored).
const anchor = await client.createAndAnchorPolicy({
  operator_id: client.operatorId,
  name: 'my-agent-v1',
  max_daily_spend: 50,
  max_per_transaction: 5,
  allowed_endpoint_categories: ['x402', 'mpp'],
  token_whitelist: ['4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'],
});
console.log('policy anchored at', client.audit.explorerTx(anchor.txSignature));

// 2. Pay an x402-protected endpoint with a ZK proof.
const policy = await client.loadActivePolicy();
const pay = await client.payX402(
  'https://api.example.com/protected-report',
  policy,
);
console.log('on-chain settlement:', client.audit.explorerTx(pay.txSignature));
// pay.recording is non-null when compliance-api persisted the proof row.
if (pay.recording) {
  console.log('proof row id:', pay.recording.proofRowId);
}

// 3. Roll up a batch attestation across the period.
const batch = await client.createBatchAttestation({
  periodStart: new Date(Date.now() - 60_000),
  periodEnd: new Date(),
});
console.log('batch tx:', client.audit.explorerTx(batch.txSignature));
console.log('batch attestation id:', batch.attestationId);
```

## Public API

```ts
import {
  // High-level entry point
  ApertureClient,

  // HTTP clients
  PolicyClient,
  ProverClient,
  ComplianceClient,

  // Flows
  X402Flow,
  MppFlow,
  AttestationFlow,
  OperatorAdmin,

  // Helpers
  Audit,
  policyIdToBytes,

  // On-chain primitives
  buildVerifyPaymentProofV2WithTransferIx,
  buildVerifyMppPaymentProofIx,
  buildEd25519VerifyIx,
  buildInitializeOperatorIx,
  buildRegisterPolicyIx,
  buildUpdatePolicyIx,
  buildDeactivatePolicyIx,
  buildVerifyBatchAttestationIx,
  deriveOperatorPDA,
  derivePolicyPDA,
  deriveProofRecordPDA,
  deriveComplianceStatusPDA,
  deriveOperatorStatePDA,
  deriveAttestationRecordPDA,
  readOperatorState,
  readEffectiveDailySpentLamports,
} from '@aperturerwa/sdk';
```

## Lifecycle reference

```text
┌───────────────────────── onboarding (one-time) ─────────────────────────┐
│ client.operator.initializeOperator()       initialize_operator ix       │
│ client.policy.createPolicy({rules})        POST /api/v1/policies        │
│ client.operator.anchorPolicy(id)           register_policy ix +         │
│                                            PATCH /onchain-confirmation  │
│   (or use the convenience createAndAnchorPolicy({rules}) to do all 3)   │
└──────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────── runtime (per payment) ─────────────────────────┐
│ const policy = await client.loadActivePolicy()                              │
│ client.payX402(endpoint, policy)                                            │
│   ├─ GET 402 challenge                                                      │
│   ├─ read OperatorState.daily_spent                                         │
│   ├─ prover-service POST /prove                Circom + Groth16             │
│   ├─ verify_payment_proof_v2_with_transfer    (atomic verify + transfer)   │
│   ├─ replay GET with proof header              (merchant unlocks resource) │
│   ├─ POST /api/v1/proofs                       (compliance row recorded)    │
│   └─ POST /compress-attestation                (Light Protocol, optional)   │
│ client.payMpp(endpoint, policy)                                             │
│   ├─ GET 402 challenge (Stripe PaymentIntent)                               │
│   ├─ Stripe off_session confirm                                             │
│   ├─ poll compliance-api for signed Poseidon receipt                        │
│   ├─ prover-service POST /prove (stripe_receipt_hash bound)                 │
│   └─ Ed25519 verify + verify_mpp_payment_proof (single tx)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────── audit + attestation ────────────────────────────┐
│ client.createBatchAttestation({periodStart, periodEnd})                     │
│   ├─ POST /api/v1/attestations/batch                                        │
│   └─ verify_batch_attestation ix on-chain                                   │
│ client.audit.proofUrl(recording.proofRowId)                                 │
│ client.audit.attestationUrl(batchResult.attestationId)                      │
│ client.audit.explorerTx(result.txSignature)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Public input layout (the ZK circuit)

The payment circuit emits ten 32-byte public inputs in this fixed order; the on-chain verifier reads them at these exact indices.

```
[0] is_compliant
[1] policy_data_hash
[2] recipient_high           // upper 16 bytes of recipient pubkey
[3] recipient_low            // lower 16 bytes
[4] amount_lamports
[5] token_mint_high
[6] token_mint_low
[7] daily_spent_before
[8] current_unix_timestamp
[9] stripe_receipt_hash      // '0' for x402
```

`PAYMENT_PUBLIC_INPUTS = 10`. Instruction builders validate this strictly; passing a different count surfaces as `Error: public_inputs must have exactly 10 entries` rather than silently corrupting on-chain payloads.

## Configuration

| Option | Required | Default |
|--------|----------|---------|
| `wallet` | yes | none |
| `policyServiceUrl` | yes | none |
| `proverServiceUrl` | yes | none |
| `complianceApiUrl` | yes | none |
| `rpcUrl` | no | `https://api.devnet.solana.com` |
| `connection` | no | built from `rpcUrl` |
| `dashboardUrl` | no | unset; audit URL helpers fall back to Solana Explorer |
| `cluster` | no | `'devnet'` |
| `programs.verifier` | no | `AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU` |
| `programs.policyRegistry` | no | `FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU` |
| `stripeSecretKey` | MPP only | none |
| `stripeCredentialsResolver` | MPP only | dashboard lookup against compliance-api |
| `stripeConfirmer` | MPP only | off_session direct confirm via Stripe REST |
| `hookAccountsResolver` | Token-2022 mints with TransferHook | none |
| `fetch` | no | global `fetch` |

## Examples and tests (require cloning the repo)

The runnable example scripts and Vitest suites live in this package's `examples/` and `tests/` folders. When you `npm install @aperturerwa/sdk`, only the built `dist/` is shipped, so to run these you should clone the source repository at https://github.com/wienerlabs/aperture and work from inside `sdk/aperture-sdk/`.

| Script | What it does |
|--------|--------------|
| `examples/policy-cli.mjs` | Interactive CLI. Prompts for every policy rule, validates input, creates + anchors on-chain. No defaults. |
| `examples/pay-x402.mjs` | Loads the active policy and pays an x402 endpoint. |
| `examples/pay-mpp.mjs` | Same flow over Stripe + on-chain MPP attestation. |
| `examples/onboard-fresh-wallet.mjs` | End-to-end: new keypair, policy, x402, batch. |

After cloning, run any of them from the repo root:

```bash
node --env-file=.env sdk/aperture-sdk/examples/onboard-fresh-wallet.mjs
```

The test suites are split into two:

```bash
# Pure unit tests: byte encoding, PDA derivation, hash + poll utilities.
# No I/O, no env required. 42 tests in ~1s.
cd sdk/aperture-sdk
npm test

# Live tests against real services + Solana devnet + Stripe.
# Auto-loads .env from the repo root.
# Required env: SOLANA_RPC_URL, AGENT_WALLET_PRIVATE_KEY (a funded wallet).
# Optional:    APERTURE_TEST_MPP_ENABLED=1 + STRIPE_SECRET_KEY
npm run test:live

# Run a specific live test
npm run test:live -- tests/integration/full-lifecycle.live.test.ts
```

The full-lifecycle test creates a brand new Solana keypair every run and drives the entire flow end-to-end (operator init, policy, on-chain anchor, x402 payment, batch attestation, audit URLs) through the SDK only. The Aperture dashboard is never touched.

## License

MIT
