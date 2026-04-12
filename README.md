# Aperture

ZK-based compliance and privacy layer for AI agent payments on Solana.

Aperture enables AI agents to prove compliance with operator-defined policies (spending limits, sanctions checks, allowed categories, time-based rules) without revealing payment details. Uses RISC Zero zkVM for real zero-knowledge proof generation and Solana for on-chain verification.

<p align="center">
  <img src="docs/assets/banner.jpeg" alt="Aperture" width="100%" />
</p>

## Key Features

- **Real RISC Zero ZK Proofs** -- Production zkVM proving with 255KB cryptographic receipts (not dev mode stubs)
- **On-chain Verification** -- Anchor programs for policy registration, proof verification, and batch attestations
- **SPL Token-2022 Transfer Hook** -- vUSDC token with compliance-enforcing transfer hook (rejects non-compliant transfers)
- **x402 Payment Protocol** -- HTTP 402 paywall for compliance reports with ZK proof + USDC payment
- **MPP (Machine Payments Protocol)** -- Stripe-backed HTTP 402 payment flow with ZK proof verification on Solana Devnet
- **Light Protocol ZK Compression** -- Compressed attestation tokens for 146x cheaper proof storage
- **Squads V4 Multisig** -- Multi-signature policy management on Devnet
- **Autonomous Agent** -- Headless AI agent with policy enforcement, ZK proving, dual-protocol payments (x402 + MPP), and on-chain attestations
- **Agent Service** -- HTTP-controllable agent daemon with Start/Stop API, pre-start validation, and real-time activity feed
- **Dashboard** -- Full-featured Next.js 14 frontend with wallet integration, dark/light theme, proof generation, agent monitoring, and Solana explorer links
- **Multi-Auth** -- Wallet signing (Phantom, Solflare), email/password, and Google OAuth via NextAuth

## Solana Devnet Deployments

| Program | Program ID | Explorer |
|---------|-----------|----------|
| Policy Registry | `CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs` | [View](https://explorer.solana.com/address/CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs?cluster=devnet) |
| ZK Verifier | `HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr` | [View](https://explorer.solana.com/address/HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr?cluster=devnet) |
| Transfer Hook | `3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt` | [View](https://explorer.solana.com/address/3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt?cluster=devnet) |

## Architecture

```
aperture/
├── programs/
│   ├── policy-registry/       # On-chain policy management (Anchor)
│   ├── verifier/              # ZK proof verification + ComplianceStatus PDA (Anchor)
│   └── transfer-hook/         # SPL Token-2022 compliance hook (pure Solana SDK)
├── circuits/
│   ├── payment-prover/        # RISC Zero zkVM -- single payment compliance proof
│   └── batch-aggregator/      # RISC Zero zkVM -- batch attestation aggregation
├── sdk/
│   ├── prover/                # Rust proof generation client
│   ├── x402-adapter/          # Coinbase x402 protocol adapter
│   ├── mpp-adapter/           # Stripe/Tempo MPP adapter
│   └── agent/                 # Autonomous AI agent SDK (policy + ZK + pay + attest)
├── services/
│   ├── policy-service/        # Policy CRUD + auth API (port 3001)
│   ├── compliance-api/        # Attestation + x402 + MPP protected endpoints (port 3002)
│   ├── prover-service/        # RISC Zero zkVM HTTP prover (port 3003)
│   └── agent-service/         # Agent daemon with HTTP control API (port 3004)
├── shared/types/              # @aperture/types -- shared TypeScript type definitions
├── dashboard/                 # Next.js 14 frontend with wallet adapter
├── scripts/                   # Deployment, testing, and setup scripts
└── docs/assets/               # Project assets (banner, images)
```

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- Solana CLI 2.1+ (for on-chain operations)
- Rust 1.75+ (for prover-service and circuits)
- RISC Zero toolchain (for ZK proof generation)

### Docker Deployment (Recommended)

The fastest way to run the full stack:

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env with your Stripe keys, MPP secret, wallet key, etc.

# 2. Start all services
docker compose up -d postgres-policy postgres-compliance
docker compose up -d policy-service compliance-api
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
| `compliance-api` | 3002 | Compliance + x402 + MPP endpoints |
| `agent-service` | 3004 | Autonomous agent daemon |
| `postgres-policy` | 5432 | Policy database |
| `postgres-compliance` | 5433 | Compliance database |

> **Note:** `prover-service` (port 3003) requires RISC Zero toolchain and an x86_64 environment. On Apple Silicon, use Bonsai cloud proving (see below).

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
npm run dev:compliance # Compliance API + MPP (port 3002)
npm run dev:agent      # Agent Service (port 3004)

# Start dashboard
cd dashboard && npm run dev
```

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
| **Policies** | Create, edit, delete compliance policies with on-chain registration |
| **Payments** | x402 and MPP payment flows, transfer hook testing |
| **Compliance** | Attestation history, proof records, audit trail |
| **Agent Activity** | Start/stop agent, live activity feed, real-time stats |
| **Settings** | Operator configuration |

### Theme

Dark and light modes are supported with a toggle in the navbar. Light mode follows WCAG AA contrast standards.

## Agent Service

### Pre-Start Validation

The agent validates three conditions before starting:

1. **Active policy exists** -- At least one policy must be created
2. **Required categories** -- Policy must include `x402` and `mpp` in `allowed_endpoint_categories`
3. **Prover service available** -- Prover service health check must pass

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
1. Load and compile policy from policy-service
2. x402 flow: check policy -> generate ZK proof -> USDC payment -> submit proof record
3. MPP flow: check policy -> generate ZK proof -> Stripe payment -> submit proof record
4. Create batch attestation -> anchor on Solana Devnet
```

## RISC Zero ZK Proof Pipeline

The prover service runs the RISC Zero zkVM to generate real zero-knowledge proofs:

1. **Policy compiled** -- Operator's compliance policy is compiled for the circuit
2. **Guest program executed** -- `circuits/payment-prover/` runs inside the zkVM
3. **Receipt generated** -- 255KB cryptographic receipt with proof of compliance
4. **On-chain verification** -- Receipt hash verified via `verify_payment_proof` instruction
5. **ComplianceStatus updated** -- Per-operator PDA enables transfer hook validation

```
First proof: ~5 minutes (ELF compilation + proving)
Subsequent:  ~6 seconds (warm cache)
Receipt:     255 KB production cryptographic proof
```

### Apple Silicon / Cloud Proving

The RISC Zero toolchain does not support ARM64 natively. Options:

- **Bonsai cloud proving** -- Set `BONSAI_API_KEY` and `BONSAI_API_URL` environment variables. The `default_prover()` automatically routes to Bonsai when these are set.
- **Docker x86 emulation** -- Add `platform: linux/amd64` to prover-service in docker-compose.yml (slow build, ~30-60 min).

## Transfer Hook (SPL Token-2022)

vUSDC is an SPL Token-2022 token with an on-chain transfer hook:

- Transfers require a verified `ComplianceStatus` PDA for the sender
- Non-compliant wallets are rejected with `Hook REJECTED: no compliance status`
- The hook program is written in pure Solana SDK (not Anchor) to support the SPL Transfer Hook interface discriminator
- `ExtraAccountMetaList` resolves HookConfig + ComplianceStatus + Verifier program automatically

## x402 Payment Protocol

The compliance API includes an x402-protected endpoint:

```
GET /api/v1/compliance/protected-report?operator_id=...

Response: 402 Payment Required
{
  "paymentRequirement": {
    "token": "USDC",
    "amount": "1000000",
    "description": "Aperture Compliance Report - 1 USDC"
  }
}
```

The dashboard handles the full flow: 402 -> ZK proof generation -> USDC payment -> retry with `x-402-payment` header -> compliance report.

## MPP (Machine Payments Protocol)

Stripe-backed payment protocol following the MPP spec (HTTP 402 challenge/credential/receipt). Designed for AI agent-to-service payments with ZK compliance proofs recorded on Solana.

### Flow

```
1. Client  ->  GET /api/v1/compliance/mpp-report?operator_id=...
2. Server  <-  402 + WWW-Authenticate header + mppChallenge (Stripe PaymentIntent)
3. Client  ->  Confirms payment via Stripe.js (test mode: pm_card_visa)
4. Client  ->  Generates ZK proof via RISC Zero prover service
5. Client  ->  Verifies proof on-chain (Solana Devnet verify_payment_proof)
6. Client  ->  Retries request with x-mpp-credential header
7. Server  <-  200 + Payment-Receipt header + compliance report
```

### Dual Settlement

Each MPP payment creates records in both systems:
- **Stripe** -- PaymentIntent with `mpp_version`, `mpp_resource` metadata
- **Solana Devnet** -- ZK proof verified on-chain via Verifier program, linked to operator's ComplianceStatus PDA

## Light Protocol ZK Compression

Proof records can be stored as compressed tokens via Light Protocol, reducing on-chain costs:

| | Regular PDA | Compressed Token | Savings |
|---|---|---|---|
| Per proof | 0.001462 SOL | 0.000010 SOL | 146x cheaper |
| 1,000 proofs | 1.462 SOL | 0.010 SOL | 1.452 SOL saved |

## Database Migrations

Two PostgreSQL databases with separate migration sets:

```bash
npm run migrate:policy      # policies, users tables
npm run migrate:compliance  # proof_records, attestations tables
npm run migrate             # both
```

## Shared Types (`@aperture/types`)

Shared TypeScript type definitions used across all services:

- `Policy`, `PolicyInput`, `CircuitPolicyInput` -- Policy schemas with Zod validation
- `Attestation`, `ProofRecord` -- Compliance record types
- `PaymentRequest`, `PaymentResult`, `ProverInput`, `ProverOutput` -- Payment and proof types
- `ApiResponse`, `PaginatedResponse` -- Standardized API response envelopes
- `TimeRestriction`, `DayOfWeek` -- Time-based policy constraints

## Scripts

| Script | Description |
|--------|-------------|
| `create-vusdc.sh` | Create vUSDC SPL Token-2022 with transfer hook |
| `create-compressed-mint.ts` | Create Light Protocol compressed attestation mint |
| `init-hook-v3.ts` | Initialize transfer hook ExtraAccountMetaList |
| `init-extra-account-metas.ts` | Initialize extra account metas for hook |
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
| USDT | `EJwZgeZrdC8TXTQbQBoL6bfuAnFUQS7QEkCybt4rCxsT` | SPL Token |
| vUSDC | `E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar` | SPL Token-2022 + Transfer Hook |

## Payment Protocols

| Protocol | Provider | Payment Rail | ZK Proof | On-chain Record |
|----------|----------|-------------|----------|----------------|
| **x402** | Coinbase | USDC on Solana Devnet | RISC Zero | Solana Devnet TX |
| **MPP** | Stripe | Stripe PaymentIntent (card/crypto) | RISC Zero | Solana Devnet TX + Stripe PI |

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_USER=aperture
POSTGRES_PASSWORD=<your-password>

# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com

# Stripe (MPP)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
MPP_SECRET_KEY=<openssl rand -base64 32>

# Agent
AGENT_WALLET_PRIVATE_KEY=<base58-private-key>

# Prover
PROVER_SERVICE_URL=http://localhost:3003
# BONSAI_API_KEY=<your-bonsai-key>        # Optional: cloud proving
# BONSAI_API_URL=https://api.bonsai.xyz/  # Optional: cloud proving

# Light Protocol (optional)
NEXT_PUBLIC_LIGHT_RPC_URL=https://devnet.helius-rpc.com/?api-key=<YOUR_KEY>

# Auth (dashboard)
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
# GOOGLE_CLIENT_ID=<optional>
# GOOGLE_CLIENT_SECRET=<optional>
```

## License

See [LICENSE](./LICENSE) for details.
