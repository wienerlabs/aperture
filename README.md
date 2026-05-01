# Aperture - Prove everything. Reveal nothing.


Compliance enforced payments for autonomous AI agents on Solana. Every transfer is gated by a zero knowledge proof of policy adherence; an Anchor instruction atomically verifies the proof, byte binds it to a specific token transfer, advances the operator's daily spend counter, and only then settles the transfer.

Aperture lets AI agents prove compliance with operator defined policies (spending limits, blocked addresses, allowed categories, time restrictions, token whitelist) without revealing payment details. Uses Circom + snarkjs Groth16 proofs verified on Solana via the alt_bn128 syscalls, plus a Stripe trusted oracle path for fiat rails.

<p align="center">
  <img src="docs/assets/banner.jpeg" alt="Aperture" width="100%" />
</p>

## Key Features

- **Production ZK proofs** -- Circom + snarkjs Groth16 proofs verified on-chain via the Solana alt_bn128 syscalls and groth16-solana. Ten public inputs bind every proof to its policy hash, recipient, amount, mint, daily-spent, current Solana clock timestamp, and (for MPP) the Stripe receipt commitment.
- **Atomic verify + transfer** -- The `verify_payment_proof_v2_with_transfer` Anchor instruction verifies the Groth16 proof, cross-checks public inputs against an inner SPL Token transfer instruction (recipient ATA, amount, mint), advances `OperatorState.daily_spent`, and only then signs the inner transfer. No race window between proof and settlement.
- **Multi-token support** -- A single policy can whitelist multiple mints. USDC and USDT are SPL Token v1; aUSDC is SPL Token-2022 with a compliance enforcing transfer hook. The verifier accepts any whitelisted mint provided the proof binds to it.
- **MPP (Machine Payments Protocol)** -- Stripe-backed HTTP 402 flow. The compliance API verifies the Stripe webhook signature, builds a Poseidon receipt commitment, signs an attestation with an ed25519 authority key, and the on-chain `verify_mpp_payment_proof` instruction checks that signature via Solana's native Ed25519 precompile (read through the Sysvar Instructions account) before recording the proof.
- **SPL Token-2022 Transfer Hook (legacy aUSDC path)** -- The aUSDC mint carries a transfer hook that rejects any movement which does not match a verified, unconsumed proof, kept for backwards compatibility with pre-atomic-ix integrations.
- **x402 Payment Protocol** -- HTTP 402 paywall for compliance protected resources. Client receives the requirement, generates a ZK proof, and submits a single transaction that verifies the proof and transfers the token in one atomic Anchor call.
- **Light Protocol ZK Compression** -- Compressed attestation tokens for ~146x cheaper proof storage.
- **Squads V4 Multisig** -- Multi-signature policy management on Devnet.
- **Autonomous Agent** -- Headless AI agent with policy enforcement, ZK proving, dual-protocol payments (x402 + MPP), and on-chain attestations.
- **Agent Service** -- HTTP-controllable agent daemon with Start/Stop API, pre-start validation, and real-time activity feed.
- **Dashboard** -- Full-featured Next.js 14 frontend with wallet integration, dark/light theme, proof generation, agent monitoring, multi-token policy editor, agent Stripe card configuration, and Solana explorer links.
- **Multi-Auth** -- Wallet signing (Phantom, Solflare), email/password, and Google OAuth via NextAuth.

## Solana Devnet Deployments

| Program | Program ID | Explorer |
|---------|-----------|----------|
| Policy Registry | `FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU` | [View](https://explorer.solana.com/address/FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU?cluster=devnet) |
| ZK Verifier | `AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU` | [View](https://explorer.solana.com/address/AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU?cluster=devnet) |
| Transfer Hook | `3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt` | [View](https://explorer.solana.com/address/3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt?cluster=devnet) |

### Address Lookup Table

A pre-populated ALT keeps the v0 transactions used by x402 and MPP flows under the size cap.

| Item | Value |
|------|-------|
| ALT pubkey | `Fi9WdrUvNFwqV339v3MBrueASEWhn867gHwGT1vFHVcf` |
| Cluster | Devnet |
| Addresses | Verifier, Policy Registry, Transfer Hook, System Program |

The dashboard and agent SDK both load this ALT into every transaction that touches the verifier so MessageV0 can resolve the static program IDs through the table instead of inlining them.

## On-chain Verification Evidence

Every proof verification is recorded on-chain with a full audit trail. Below are live transactions on Solana Devnet demonstrating the system in production.

**Verifier Program Logs (atomic verify + transfer)**

```
Program AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU invoke [1]
Program log: Instruction: VerifyPaymentProofV2WithTransfer
Program log: Groth16 verified, binding public inputs to inner transfer ix
Program log: recipient OK, amount OK, mint OK, timestamp OK, daily_spent OK
Program log: OperatorState.daily_spent advanced; signing inner transfer
Program AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU success
```

**Verifier Program Logs (MPP B-flow)**

```
Program AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU invoke [1]
Program log: Instruction: VerifyMppPaymentProof
Program log: Reading sysvar instructions, expecting Ed25519Program at index 0
Program log: Ed25519 signature verified against MPP authority pubkey
Program log: Poseidon receipt commitment matches public input
Program log: Recording ProofRecord PDA for operator
Program AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU success
```

The verifier performs Groth16 verification (alt_bn128 syscalls), public input cross-binding against the inner transfer, byte-by-byte ed25519 attestation verification (MPP path) via the native precompile, and atomic OperatorState mutation. No off-chain trust besides the Stripe webhook signature on the MPP path.

**Merkle Tree Policy Storage**

Policy rules are stored as a binary Merkle tree. Each rule (spending limits, blocked addresses, allowed categories, token whitelist, time restrictions) becomes a leaf node. The tree root is stored on-chain, enabling selective disclosure: prove a specific rule exists without revealing other rules.

```
Policy: "frontier" (6 rules)

                          root: 4b92078a...
                        /                    \
                 8c0513ff...              726c9737...
                /          \             /          \
         44d26a1d...  40aea26a...  a4494d5e...  d8459fcf...
              |            |            |            |
        max_daily    max_per_tx   allowed_cat  blocked_addr
```

Three independent proofs, same root, different rules revealed:

```
Rule: max_daily_spend    -> leaf: 44d26a1d... -> 3 siblings -> root: 4b92078a... -> verified: true
Rule: blocked_addresses  -> leaf: d8459fcf... -> 3 siblings -> root: 4b92078a... -> verified: true
Rule: token_whitelist    -> leaf: a1b5b614... -> 3 siblings -> root: 4b92078a... -> verified: true
```

An auditor verifying `blocked_addresses` sees only that the rule exists in the policy. The values of `max_daily_spend`, `max_per_transaction`, `allowed_categories`, `token_whitelist`, and `time_restrictions` remain hidden. This is selective disclosure: prove everything, reveal nothing.

API endpoints for Merkle operations:

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/policies/:id/merkle-tree` | Full tree with root, leaves, and labels |
| `GET /api/v1/policies/:id/merkle-proof/:rule` | Merkle proof for a specific rule with verification |

## Architecture

```
aperture/
├── programs/
│   ├── policy-registry/       # On-chain policy management (Anchor)
│   ├── verifier/              # ZK proof verification, atomic verify+transfer, MPP B-flow (Anchor + groth16-solana)
│   └── transfer-hook/         # SPL Token-2022 compliance hook (pure Solana SDK, legacy aUSDC path)
├── circuits/
│   └── payment-prover/        # Circom 2 circuit + snarkjs Groth16 setup, proving keys, vkey
├── sdk/
│   ├── prover/                # Proof generation client (snarkjs wrapper)
│   ├── x402-adapter/          # Coinbase x402 protocol adapter
│   ├── mpp-adapter/           # Stripe MPP adapter
│   └── agent/                 # Autonomous AI agent SDK (policy + ZK + pay + attest)
├── services/
│   ├── policy-service/        # Policy CRUD + auth API (port 3001)
│   ├── compliance-api/        # Attestation + x402 + MPP protected endpoints + Stripe webhook (port 3002)
│   ├── prover-service/        # Circom + snarkjs HTTP prover (port 3003)
│   └── agent-service/         # Agent daemon with HTTP control API (port 3004)
├── shared/types/              # @aperture/types -- shared TypeScript type definitions
├── dashboard/                 # Next.js 14 frontend with wallet adapter
├── scripts/                   # Deployment, ALT setup, mint creation, hook init, integration tests
└── docs/assets/               # Project assets (banner, images)
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Solana CLI 2.1+ (for on-chain operations)
- Rust 1.75+ (only required if you want to rebuild the Anchor programs)
- Circom 2 + snarkjs (only required if you want to rebuild proving keys; pre-built artifacts ship in `circuits/payment-prover/build/`)

### Docker Deployment (Recommended)

The fastest way to run the full stack:

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your Solana RPC, Stripe keys, MPP authority, agent wallet, etc.

# 2. Start all services
docker compose up -d postgres-policy postgres-compliance
docker compose up -d policy-service compliance-api prover-service
docker compose up -d agent-service aperture

# 3. Run database migrations
npm install
npm run migrate

# 4. Open dashboard
open http://localhost:3000
```

This starts:

| Container | Port | Description |
|-----------|------|-------------|
| `aperture` | 3000 | Next.js dashboard |
| `policy-service` | 3001 | Policy CRUD API |
| `compliance-api` | 3002 | Compliance + x402 + MPP endpoints + Stripe webhook |
| `prover-service` | 3003 | Circom + snarkjs HTTP prover |
| `agent-service` | 3004 | Autonomous agent daemon |
| `postgres-policy` | 5432 | Policy database |
| `postgres-compliance` | 5433 | Compliance database |

### Local Development

```bash
# Install dependencies
npm install
cd dashboard && npm install

# Start databases
docker compose up -d postgres-policy postgres-compliance

# Run migrations
npm run migrate

# Start backend services
npm run dev:policy     # Policy Service (port 3001)
npm run dev:compliance # Compliance API + Stripe webhook + MPP (port 3002)
npm run dev:prover     # Prover Service (port 3003)
npm run dev:agent      # Agent Service (port 3004)

# Start dashboard
cd dashboard && npm run dev
```

### Railway / Production

Each service ships its own Dockerfile and is deployable as a Railway service. The dashboard, policy-service, compliance-api, prover-service, and agent-service all read configuration purely from environment variables. Two managed Postgres instances back the policy and compliance databases. The Stripe webhook endpoint must point at `https://<compliance-api-host>/api/v1/payments/mpp/webhook` with `payment_intent.succeeded` enabled, and the MPP authority Ed25519 keypair must be present on the compliance-api so it can sign attestations consumed by the on-chain verifier.

## Dashboard

The dashboard provides a full UI for managing compliance operations.

### Authentication

Three sign-in methods are supported via NextAuth:

| Method | Flow |
|--------|------|
| **Wallet** | Connect Phantom/Solflare, sign message, verified by policy-service |
| **Email/Password** | Credentials stored in policy-service database |
| **Google OAuth** | Requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` |

### Tabs

| Tab | Description |
|-----|-------------|
| **Overview** | Operator summary, recent activity, key metrics |
| **Policies** | Create, edit, delete compliance policies with on-chain registration; multi-token whitelist editor |
| **Payments** | x402 and MPP payment flows, transfer hook testing, multi-mint selector |
| **Compliance** | Attestation history, proof records, audit trail |
| **AIP Agents** | Conversational AI agents with capability gating; every tool call is paid via x402 or MPP and proof-verified on-chain |
| **Agent Activity** | Start/stop agent, live activity feed, real-time stats |
| **Settings** | Operator configuration and **Configure Agent Card** (Stripe SetupIntent flow that stores a `customer_id` + `payment_method_id` so the agent can charge off_session during MPP cycles) |

### Theme

Dark and light modes are supported with a toggle in the navbar. Light mode follows WCAG AA contrast standards.

### Public pages

| Path | Description |
|------|-------------|
| `/` | Marketing landing with integrations band (Solana, Helius, Circom, Light Protocol, Coinbase, Squads, Stripe) |
| `/docs` | Architecture, SDK reference, integration guides |
| `/developers` | API key manager, quick-start curls, code samples sourced from the repo, Devnet program registry |
| `/integrate` | Step-by-step integration flows (x402, MPP, Transfer Hook, Light Protocol, Squads, custom Circom circuits) |
| `/api-docs` | Live OpenAPI 3.0 specs fetched at runtime from each backend service |
| `/status` | Real-time health (10s polling) for Policy / Compliance / Prover / Agent services + Solana RPC + Helius RPC |
| `/changelog` | Release notes |

### API keys

Programmatic access is authenticated via an `X-API-Key` header. Keys are scoped to a user account, generated through `/developers`, hashed at rest (`api_keys.key_hash`), and revocable. The plain-text key is shown exactly once at creation.

## Agent Service

### Pre-Start Validation

The agent validates three conditions before starting:

1. **Active policy exists** -- At least one policy must be created
2. **Required categories** -- Policy must include `x402` and `mpp` in `allowed_endpoint_categories`
3. **Prover service available** -- Prover service health check must pass

For the MPP cycle to actually execute, the operator must also have completed the **Configure Agent Card** flow in the Settings tab so that `operator_stripe_credentials` has a saved `customer_id` and `payment_method_id`. If those are missing the cycle is skipped (logged) instead of erroring.

If any check fails, the agent returns a descriptive error and does not start.

### API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/start` | POST | Validate policy + prover, start agent loop |
| `/stop` | POST | Stop agent loop |
| `/status` | GET | Running state, operator ID, stats |
| `/activity` | GET | Live activity feed (last 200 records) |
| `/health` | GET | Service health check |

### Agent Loop Cycle

Each cycle (every 30 seconds):

```
1. Load and compile policy from policy-service (multi-token aware)
2. x402 flow:
     check policy -> generate Groth16 proof
     -> single atomic tx: verify_payment_proof_v2_with_transfer + inner SPL transfer to treasury
3. MPP flow (only if Stripe credentials configured):
     check policy -> create off_session PaymentIntent (Stripe customer + payment method)
     -> wait for payment_intent.succeeded webhook
     -> compliance-api builds Poseidon receipt commitment + ed25519 attestation
     -> generate Groth16 proof bound to that receipt
     -> single atomic tx: verify_mpp_payment_proof (with Ed25519Program ix at index 0)
4. Create batch attestation -> anchor on Solana Devnet
```

## ZK Proof Pipeline (Circom + snarkjs Groth16)

The prover service runs a Circom 2 circuit through snarkjs to generate Groth16 proofs that are verifiable directly on Solana via the alt_bn128 syscalls.

1. **Policy compiled** -- Operator's compliance policy (limits, whitelist, blocked, categories, time restrictions) is reduced to Poseidon commitments matching the in-circuit hashing
2. **Witness generated** -- The prover service runs the Circom-compiled witness generator with private policy values + public payment fields
3. **Groth16 proof produced** -- snarkjs returns an ~256 byte proof and the ten public signals (is_compliant, policy_data_hash, recipient_high/low, amount_lamports, token_mint_high/low, daily_spent_before, current_unix_timestamp, stripe_receipt_hash)
4. **On-chain verification** -- The proof bytes are submitted with a v0 transaction; the Anchor verifier program decodes the proof, calls `alt_bn128_pairing` syscalls, cross-binds public inputs against the inner transfer (or against the ed25519 receipt for MPP), and atomically advances `OperatorState.daily_spent`
5. **Settlement** -- For x402 the verifier signs the inner SPL transfer in the same instruction; for MPP it records a `ProofRecord` PDA against the already-completed Stripe payment

```
Proving time:    ~600 ms warm, single Circom witness + Groth16 prove
Proof size:      ~256 bytes (a, b, c) + ten 32-byte public signals
On-chain CUs:    ~200K compute units for verify + transfer in one tx
Trusted setup:   shipped under circuits/payment-prover/build/payment_final.zkey
```

### Why Circom + snarkjs

Circom + snarkjs Groth16 is the only ZK stack that targets BN254 natively, has on-chain verification primitives in Solana mainline (`alt_bn128_*` syscalls + groth16-solana), produces proofs small enough to submit in a single Solana transaction, and proves fast enough on commodity CPUs to run inside an HTTP service. Aperture previously evaluated zkVM stacks; the trade off (multi-second proving, ~250 KB receipts, additional verifier router contracts) was not justified for a payment-gating circuit of this size.

## Atomic Verify + Transfer (`verify_payment_proof_v2_with_transfer`)

This is the production payment instruction used by both the dashboard and the agent for x402-style flows.

What it does, all in one Anchor instruction:

1. Decodes the Groth16 proof bytes and ten public inputs
2. Loads the operator's `OperatorState` PDA and `PolicyAccount` (cross-checks `policy_data_hash`)
3. Reads the Sysvar Instructions account, finds the inner SPL Token transfer instruction, and binds:
   - `recipient_high/low` against the destination ATA owner
   - `amount_lamports` against the transfer amount
   - `token_mint_high/low` against the SPL mint of the source ATA
   - `current_unix_timestamp` against `Clock::get()`
   - `daily_spent_before` against `OperatorState.daily_spent`
4. Calls `alt_bn128_pairing` to verify the Groth16 proof against the embedded verifying key
5. If `is_compliant == 1`, atomically writes the new `daily_spent` and signs the inner transfer; otherwise the whole transaction fails
6. Records a `ProofRecord` PDA so the proof cannot be replayed

There is no race between proving compliance and moving funds: a single tx either does both or neither.

## Transfer Hook (SPL Token-2022, legacy aUSDC path)

aUSDC is an SPL Token-2022 mint with an on-chain transfer hook kept for backwards compatibility:

- Transfers require a verified `ComplianceStatus` PDA for the sender
- Non-compliant wallets are rejected with `Hook REJECTED: no compliance status`
- The hook program is written in pure Solana SDK (not Anchor) to support the SPL Transfer Hook interface discriminator
- `ExtraAccountMetaList` resolves HookConfig + ComplianceStatus + Verifier program automatically

New integrations should prefer the atomic verify + transfer instruction over the hook, since it removes the extra round-trip needed to seed `ComplianceStatus` before the transfer.

## x402 Payment Protocol

The compliance API includes an x402-protected endpoint:

```
GET /api/v1/compliance/protected-report?operator_id=...

Response: 402 Payment Required
{
  "paymentRequirement": {
    "token": "USDC",
    "amount": "1000000",
    "treasury": "GRyQkYHeqEYT9KmANxAA9mtw6iJoqCtxVNCNRQD8PrMq",
    "description": "Aperture Compliance Report - 1 USDC"
  }
}
```

The dashboard handles the full flow: 402 -> ZK proof generation -> single atomic verify+transfer tx to the treasury -> retry with `x-402-payment` header -> compliance report. The treasury wallet is fixed per deployment via the `PUBLISHER_WALLET` env var, so any whitelisted mint (USDC / USDT / aUSDC) can be selected at proof time.

## MPP (Machine Payments Protocol)

Stripe-backed payment protocol following the MPP spec (HTTP 402 challenge / credential / receipt). Designed for AI agent-to-service payments with ZK compliance proofs recorded on Solana, bound to the Stripe receipt by an ed25519 attestation.

### B-flow (the production path)

```
1. Client    ->  GET /api/v1/compliance/mpp-report?operator_id=...
2. Server    <-  402 + WWW-Authenticate + mppChallenge (Stripe PaymentIntent client_secret)
3. Client    ->  Confirms PaymentIntent (browser flow) OR agent charges saved card off_session
4. Stripe    ->  POST /api/v1/payments/mpp/webhook (payment_intent.succeeded)
5. compliance-api verifies Stripe webhook signature
                 -> hashes the receipt fields with Poseidon
                 -> signs attestation with the MPP authority Ed25519 keypair
                 -> exposes the attestation to the client
6. Client    ->  Generates Groth16 proof bound to the Poseidon receipt commitment
7. Client    ->  Submits a single Solana tx:
                 [Ed25519Program signature ix at index 0]
                 [verify_mpp_payment_proof Anchor ix]
8. On-chain verifier reads the sysvar instructions, checks the ed25519 signature,
   verifies the Groth16 proof, and writes a ProofRecord PDA
9. Client    ->  Retries the original GET with x-mpp-credential
10. Server   <-  200 + Payment-Receipt header + compliance report
```

### Dual Settlement

Each MPP payment creates records in both systems:
- **Stripe** -- PaymentIntent with `mpp_version`, `mpp_resource`, and `operator_id` metadata
- **Solana Devnet** -- Groth16 proof verified on-chain via `verify_mpp_payment_proof`, linked to the operator's `OperatorState` PDA and bound to the Stripe receipt commitment

### Agent off_session card

The Settings tab exposes a **Configure Agent Card** flow that creates a Stripe SetupIntent, attaches a payment method to a per-operator Stripe customer, and persists `customer_id` + `payment_method_id` in the `operator_stripe_credentials` table. The agent uses these credentials to charge the card with `off_session=true` during its MPP cycle, fully unattended.

## Light Protocol ZK Compression

Proof records can be stored as compressed tokens via Light Protocol, reducing on-chain costs:

| | Regular PDA | Compressed Token | Savings |
|---|---|---|---|
| Per proof | 0.001462 SOL | 0.000010 SOL | 146x cheaper |
| 1,000 proofs | 1.462 SOL | 0.010 SOL | 1.452 SOL saved |

## Database Migrations

Two PostgreSQL databases with separate migration sets:

```bash
npm run migrate:policy      # policies, users, api_keys, operator_stripe_credentials tables
npm run migrate:compliance  # proof_records, attestations, mpp_receipts tables
npm run migrate             # both
```

## Shared Types (`@aperture/types`)

Shared TypeScript type definitions used across all services:

- `Policy`, `PolicyInput`, `CircuitPolicyInput` -- Policy schemas with Zod validation, including multi-token `token_whitelist`
- `Attestation`, `ProofRecord`, `MppReceipt` -- Compliance record types
- `PaymentRequest`, `PaymentResult`, `ProverInput`, `ProverOutput` -- Payment and proof types
- `ApiResponse`, `PaginatedResponse` -- Standardized API response envelopes
- `TimeRestriction`, `DayOfWeek` -- Time-based policy constraints

## Scripts

| Script | Description |
|--------|-------------|
| `create-vusdc.sh` | Create the aUSDC SPL Token-2022 mint with transfer hook (legacy filename, output is now aUSDC) |
| `create-compressed-mint.ts` | Create Light Protocol compressed attestation mint |
| `init-hook-v3.ts` | Initialize transfer hook ExtraAccountMetaList |
| `init-extra-account-metas.ts` | Initialize extra account metas for hook |
| `setup-x402-alt.ts` | Create / extend the Address Lookup Table used by x402 + MPP transactions |
| `test-onchain.ts` | End-to-end on-chain integration test |
| `test-compressed-mint.ts` | Test compressed token minting |
| `test-hook-*.ts` | Transfer hook test variants |
| `debug-hook.ts` | Transfer hook debugging utility |
| `deploy.sh` | Program deployment script |
| `dev-start.sh` | Development environment startup |

## API Documentation

| Service | URL | Swagger |
|---------|-----|---------|
| Policy Service | http://localhost:3001 | http://localhost:3001/api-docs |
| Compliance API | http://localhost:3002 | http://localhost:3002/api-docs |
| Prover Service | http://localhost:3003 | http://localhost:3003/health |
| Agent Service | http://localhost:3004 | http://localhost:3004/status |

## Supported Tokens (Devnet)

| Token | Mint | Type |
|-------|------|------|
| USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | SPL Token |
| USDT | `92rsgTRBkCt16wMXFGEujHpj4WLpixoWRkP6wrLVooSm` | SPL Token |
| aUSDC | `E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar` | SPL Token-2022 + Transfer Hook |

A policy may whitelist any subset of these mints; the proof binds to the specific mint chosen at payment time, and the verifier rejects any transfer whose mint does not match the proof.

## Payment Protocols

| Protocol | Provider | Payment Rail | ZK Proof | On-chain Record |
|----------|----------|--------------|----------|-----------------|
| **x402** | Coinbase | USDC / USDT / aUSDC on Solana Devnet | Circom + snarkjs Groth16 | Atomic verify + SPL transfer in a single Solana tx |
| **MPP** | Stripe | Stripe PaymentIntent (off_session card supported) | Circom + snarkjs Groth16 + ed25519 receipt attestation | Solana Devnet ProofRecord (verify_mpp_payment_proof) + Stripe PI |

## Environment Variables

Copy `.env.example` to `.env` and configure. The block below shows the variable names only; never commit real values.

```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_USER=
POSTGRES_PASSWORD=

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
PUBLISHER_WALLET=         # treasury wallet that receives x402 payments

# SPL mints (Devnet defaults are fine)
PAYMENT_MINT_ADDRESS=     # USDC mint by default
USDT_MINT_ADDRESS=        # USDT mint
AUSDC_MINT_ADDRESS=       # optional, only needed for the legacy hook path

# Stripe (MPP)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=    # signing secret for /api/v1/payments/mpp/webhook
MPP_AUTHORITY_KEYPAIR_BASE58=   # ed25519 keypair the on-chain verifier expects

# Agent
AGENT_WALLET_PRIVATE_KEY=

# Prover
PROVER_SERVICE_URL=http://localhost:3003

# Light Protocol (optional)
NEXT_PUBLIC_LIGHT_RPC_URL=

# Auth (dashboard)
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Cross-origin (production deployments only)
CORS_ORIGINS=             # comma-separated list, e.g. https://your-dashboard.example
```

## License

See [LICENSE](./LICENSE) for details.
