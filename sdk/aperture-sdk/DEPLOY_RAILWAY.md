# Deploying Aperture Backend Services to Railway

This walks through standing up the three Aperture backend services (`policy-service`, `prover-service`, `compliance-api`) plus two managed Postgres databases on Railway, then wiring their public URLs into the `@aperturerwa/sdk` README.

End state: anyone who runs `npm install @aperturerwa/sdk` can point at your hosted URLs and the full ZK + x402 + MPP + attestation flow works without standing up their own Docker stack.

## Prerequisites

- Railway account: https://railway.app → "Sign in with GitHub"
- The `wienerlabs/aperture` repo pushed to GitHub (it is)
- Your `.env` values handy: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MPP_AUTHORITY_KEYPAIR_BASE58`, `MPP_SECRET_KEY`, `LIGHT_RPC_URL`, `LIGHT_PAYER_PRIVATE_KEY`, `COMPRESSED_ATTESTATION_MINT`, `SOLANA_RPC_URL` (Helius)

## Plan

| Resource | Source | Public URL |
|----------|--------|------------|
| `postgres-policy` | Railway Postgres template | (internal only) |
| `postgres-compliance` | Railway Postgres template | (internal only) |
| `policy-service` | GitHub `wienerlabs/aperture` | `https://policy-aperture-production.up.railway.app` |
| `prover-service` | GitHub `wienerlabs/aperture` | `https://prover-aperture-production.up.railway.app` |
| `compliance-api` | GitHub `wienerlabs/aperture` | `https://compliance-aperture-production.up.railway.app` |

(URLs are illustrative — Railway will generate the actual hostnames.)

## Step 1 — Create the project

1. https://railway.app/new → **Empty Project**
2. Name: `aperture` (or whatever)
3. After project created, you'll land in a blank canvas

## Step 2 — Add the two Postgres databases

For each of `postgres-policy` and `postgres-compliance`:

1. **+ New** → **Database** → **Add PostgreSQL**
2. Wait for it to provision (~30s)
3. Click the service → **Settings** → rename to `postgres-policy` (or `postgres-compliance`)
4. Click **Variables** → note `POSTGRES_USER`, `POSTGRES_PASSWORD`, `PGHOST`, `PGPORT`, `PGDATABASE` for later

You'll have two of these. Don't reuse one database for both services.

## Step 3 — Deploy `policy-service`

1. **+ New** → **GitHub Repo** → select `wienerlabs/aperture`
2. After clone, click the new service → **Settings**
3. **Source**:
   - Root Directory: leave **empty** (= repo root). The Dockerfile uses the monorepo root as Docker context.
   - Branch: `main`
4. **Build**:
   - Dockerfile Path: `services/policy-service/Dockerfile`
5. **Variables** → add these (replace `${POSTGRES_POLICY.*}` with values from the postgres-policy service in the same project — Railway lets you reference them with `${{postgres-policy.PGHOST}}` syntax):

   ```env
   POSTGRES_HOST=${{postgres-policy.PGHOST}}
   POSTGRES_PORT=${{postgres-policy.PGPORT}}
   POSTGRES_USER=${{postgres-policy.PGUSER}}
   POSTGRES_PASSWORD=${{postgres-policy.PGPASSWORD}}
   POSTGRES_DB=${{postgres-policy.PGDATABASE}}
   POLICY_SERVICE_PORT=3001
   PORT=3001
   USDC_MINT_ADDRESS=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
   USDT_MINT_ADDRESS=92rsgTRBkCt16wMXFGEujHpj4WLpixoWRkP6wrLVooSm
   SOLANA_RPC_URL=<your helius or solana RPC URL>
   POLICY_REGISTRY_PROGRAM=FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU
   LOG_LEVEL=info
   ```
6. **Networking** → **Generate Domain** → Railway gives you something like `policy-aperture-production.up.railway.app`
7. Click **Deploy**. Wait for the build (~3-5 min on first build).
8. Once "Active", hit `https://<your-url>/health` in browser — should return `{"success":true,"data":{"status":"healthy",...}}`.

## Step 4 — Deploy `prover-service`

1. **+ New** → **GitHub Repo** → `wienerlabs/aperture`
2. **Settings → Source**: Root Directory empty, Branch `main`
3. **Build**: Dockerfile Path: `services/prover-service/Dockerfile`
4. **Variables**:
   ```env
   PROVER_SERVICE_PORT=3003
   PORT=3003
   LOG_LEVEL=info
   ```
5. **Networking** → Generate Domain
6. **Deploy** → wait ~5 min (Circom artifacts are bundled in the image, ~50MB)
7. Verify `https://<your-url>/health` returns `{"status":"healthy","service":"aperture-prover-service",...}`

## Step 5 — Deploy `compliance-api`

1. **+ New** → **GitHub Repo** → `wienerlabs/aperture`
2. **Settings → Source**: Root Directory empty, Branch `main`
3. **Build**: Dockerfile Path: `services/compliance-api/Dockerfile`
4. **Variables**:
   ```env
   POSTGRES_HOST=${{postgres-compliance.PGHOST}}
   POSTGRES_PORT=${{postgres-compliance.PGPORT}}
   POSTGRES_USER=${{postgres-compliance.PGUSER}}
   POSTGRES_PASSWORD=${{postgres-compliance.PGPASSWORD}}
   POSTGRES_DB=${{postgres-compliance.PGDATABASE}}
   COMPLIANCE_API_PORT=3002
   PORT=3002
   STRIPE_SECRET_KEY=<your stripe secret key>
   STRIPE_API_VERSION=2026-03-04.preview
   STRIPE_WEBHOOK_SECRET=<your stripe webhook secret>
   MPP_AUTHORITY_KEYPAIR_BASE58=<from .env>
   MPP_SECRET_KEY=<from .env>
   LIGHT_RPC_URL=<from .env>
   COMPRESSED_ATTESTATION_MINT=EraJfY2Lk1BpWHjBZuxA1T8Re36D515JLkW1FFo7Ah1P
   LIGHT_PAYER_PRIVATE_KEY=<from .env>
   SOLANA_RPC_URL=<your helius RPC URL>
   COMPLIANCE_WATCHER_MINTS=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
   LOG_LEVEL=info
   ```
5. **Networking** → Generate Domain
6. **Deploy** → wait ~5 min
7. Verify `https://<your-url>/health`

## Step 6 — Run database migrations

Both `policy-service` and `compliance-api` need to run their migrations once. Railway runs `CMD` from the Dockerfile (which starts the server, not migrations). Easiest path: use Railway's one-off command.

1. Open `policy-service` in Railway dashboard
2. Click ⋯ (three-dot menu) → **Run a Command**
3. Run: `npm run migrate --workspace=@aperture/policy-service`
4. Repeat for `compliance-api` with `npm run migrate --workspace=@aperture/compliance-api`

Alternatively, you can SSH into the service via `railway run` or add a one-off deploy of `npm run migrate` before each main deploy.

## Step 7 — Wire the Stripe webhook

1. Stripe dashboard → **Developers → Webhooks → Add endpoint**
2. URL: `https://<compliance-api-url>/api/v1/payments/mpp/webhook`
3. Events: `payment_intent.succeeded`
4. Save → copy the **Signing secret** (`whsec_...`)
5. Back in Railway → `compliance-api` → Variables → update `STRIPE_WEBHOOK_SECRET=whsec_...`
6. Redeploy

## Step 8 — Smoke test the hosted stack

Replace your local stack with the Railway URLs:

```bash
node --input-type=module -e "
import { ApertureClient } from '@aperturerwa/sdk';
import { Keypair } from '@solana/web3.js';
import fs from 'node:fs';
// load your wallet however you like
const bytes = new Uint8Array(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json','utf-8')));
const wallet = Keypair.fromSecretKey(bytes);
const client = new ApertureClient({
  wallet,
  rpcUrl: process.env.SOLANA_RPC_URL,
  policyServiceUrl: 'https://<policy-url>.up.railway.app',
  proverServiceUrl: 'https://<prover-url>.up.railway.app',
  complianceApiUrl: 'https://<compliance-url>.up.railway.app',
});
const policy = await client.loadActivePolicy();
console.log('policy ok:', policy.id);
"
```

## Step 9 — Update the SDK README + republish

Once you have the three public URLs, send them back to the SDK maintainer to:

1. Update `sdk/aperture-sdk/README.md` 60-second-tour with the real URLs
2. `npm version patch`
3. `npm publish --access public`

Now `@aperturerwa/sdk@0.1.1` ships with a "just works" example that points at hosted services.

## Troubleshooting

- **Build fails on `npm install`**: confirm `--legacy-peer-deps` isn't needed; if it is, prepend `RUN npm config set legacy-peer-deps true` in the Dockerfile.
- **Migrations error `relation does not exist`**: re-run Step 6.
- **Compliance-api crashes on boot complaining about `MPP_AUTHORITY_KEYPAIR_BASE58`**: check the var is exactly the 64-byte JSON array string from your local `.env`, not just the public key.
- **Stripe webhook 400**: signing secret mismatch. Re-copy from Stripe dashboard and update var.
- **SDK gets 502 from policy-service**: Railway service idle/cold-started. First call after deploy can be slow.
