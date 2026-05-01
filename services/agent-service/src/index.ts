import dotenv from 'dotenv';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Keypair } from '@solana/web3.js';
import { AgentLoop, type AgentConfig } from './agent-loop.js';
import { openapiSpec } from './openapi.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

// Parse wallet key (JSON array or base58)
const privateKeyRaw = requireEnv('AGENT_WALLET_PRIVATE_KEY');
let secretKeyBytes: Uint8Array;
if (privateKeyRaw.startsWith('[')) {
  secretKeyBytes = new Uint8Array(JSON.parse(privateKeyRaw) as number[]);
} else {
  // base58 decode
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt(0);
  for (const ch of privateKeyRaw) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base58 character: ${ch}`);
    num = num * 58n + BigInt(idx);
  }
  const hex = num.toString(16).padStart(128, '0');
  secretKeyBytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}
const wallet = Keypair.fromSecretKey(secretKeyBytes);

const agentConfig: AgentConfig = {
  wallet,
  operatorId: wallet.publicKey.toBase58(),
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  policyServiceUrl: process.env.POLICY_SERVICE_URL ?? 'http://localhost:3001',
  complianceApiUrl: process.env.COMPLIANCE_API_URL ?? 'http://localhost:3002',
  proverServiceUrl: process.env.PROVER_SERVICE_URL ?? 'http://localhost:3003',
  stripeSecretKey: requireEnv('STRIPE_SECRET_KEY'),
  // The transfer-hook only fires for vUSDC, so the agent must be pinned to
  // the vUSDC mint explicitly via env. Refuse to start with an unset value
  // because falling back to plain USDC would silently bypass compliance.
  // The transfer-hook only fires for aUSDC (Aperture's Token-2022 mint with
  // the compliance hook attached); the agent must be pinned to it explicitly.
  // Refuse to start with an unset value because falling back to plain USDC
  // would silently bypass on-chain compliance enforcement. Accepts either
  // the new AUSDC_MINT[_ADDRESS] env or the legacy VUSDC_MINT[_ADDRESS] for
  // backwards compatibility with .env files that pre-date the rebrand.
  ausdcMint: (() => {
    const v =
      process.env.AUSDC_MINT ??
      process.env.AUSDC_MINT_ADDRESS ??
      process.env.VUSDC_MINT ??
      process.env.VUSDC_MINT_ADDRESS;
    if (!v) {
      throw new Error(
        'Set AUSDC_MINT_ADDRESS in .env (or VUSDC_MINT_ADDRESS as a legacy fallback). The agent refuses to start without an explicit aUSDC mint pin.',
      );
    }
    return v;
  })(),
  // Optional Stripe off-session credentials. When either is unset the agent
  // skips its MPP cycle instead of failing — provisioning the customer +
  // payment method is a manual one-time SCA flow the operator does outside
  // the agent. Both must be set together; setting only one is treated as
  // unset.
  stripeCustomerId: process.env.STRIPE_CUSTOMER_ID ?? null,
  stripePaymentMethodId: process.env.STRIPE_PAYMENT_METHOD_ID ?? null,
  // Devnet ALT created by scripts/setup-x402-alt.ts (hosts the x402 program
  // IDs so the verify+transfer V0 tx fits the 1232-byte limit). Override via
  // X402_LOOKUP_TABLE for mainnet deployments.
  x402LookupTable:
    process.env.X402_LOOKUP_TABLE ?? 'Fi9WdrUvNFwqV339v3MBrueASEWhn867gHwGT1vFHVcf',
  intervalMs: parseInt(process.env.AGENT_INTERVAL_MS ?? '30000', 10),
};

const agent = new AgentLoop(agentConfig);

const app = express();
const port = parseInt(process.env.AGENT_SERVICE_PORT ?? '3004', 10);

const extraOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin: [/^http:\/\/localhost:\d+$/, ...extraOrigins],
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'agent-service', version: '0.1.0' });
});

app.get('/api-docs.json', (_req, res) => {
  res.json(openapiSpec);
});

app.get('/status', (_req, res) => {
  res.json({
    running: agent.isRunning(),
    operatorId: agent.getActiveOperatorId(),
    lastActivity: agent.getLastActivity(),
    stats: agent.getStats(),
  });
});

app.get('/activity', (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const records = agent.getActivity().slice(0, limit);
  res.json({ success: true, data: records });
});

app.post('/start', async (req, res) => {
  if (agent.isRunning()) {
    res.json({ success: true, message: 'Agent is already running' });
    return;
  }

  // The dashboard passes its connected wallet's operator_id so the agent
  // tags DB records (proof_records, attestations) under that id. Falls back
  // to the env-configured wallet if no body provided.
  const requestedOperatorId =
    typeof req.body?.operator_id === 'string' && req.body.operator_id.length > 0
      ? req.body.operator_id
      : agentConfig.operatorId;

  // Validate policy has required categories before starting
  try {
    const listRes = await fetch(
      `${agentConfig.policyServiceUrl}/api/v1/policies/operator/${requestedOperatorId}?page=1&limit=1`,
    );

    if (!listRes.ok) {
      res.status(400).json({
        success: false,
        error: 'Failed to fetch policies. Ensure the policy service is running and you have created a policy.',
      });
      return;
    }

    const listBody = (await listRes.json()) as {
      data: { allowed_endpoint_categories: string[] }[];
    };

    if (listBody.data.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No active policies found. Create a policy before starting the agent.',
      });
      return;
    }

    const categories = listBody.data[0].allowed_endpoint_categories;
    const missingCategories: string[] = [];
    if (!categories.includes('x402')) missingCategories.push('x402');
    if (!categories.includes('mpp')) missingCategories.push('mpp');

    if (missingCategories.length > 0) {
      res.status(400).json({
        success: false,
        error: `Active policy does not allow ${missingCategories.join(' or ')} payments. Edit your policy to add these categories: ${missingCategories.join(', ')}`,
      });
      return;
    }
  } catch {
    res.status(500).json({
      success: false,
      error: 'Could not validate policy. Ensure the policy service is reachable.',
    });
    return;
  }

  // Check prover service availability
  try {
    const proverRes = await fetch(`${agentConfig.proverServiceUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!proverRes.ok) throw new Error('unhealthy');
  } catch {
    res.status(400).json({
      success: false,
      error: `Prover service not reachable at ${agentConfig.proverServiceUrl}. The agent requires the prover-service (RISC Zero) to generate ZK proofs. Start the prover-service or configure PROVER_SERVICE_URL.`,
    });
    return;
  }

  agent.start(requestedOperatorId);
  res.json({ success: true, message: 'Agent started', operatorId: requestedOperatorId });
});

app.post('/stop', (_req, res) => {
  if (!agent.isRunning()) {
    res.json({ success: true, message: 'Agent is already stopped' });
    return;
  }
  agent.stop();
  res.json({ success: true, message: 'Agent stopped' });
});

const server = app.listen(port, () => {
  console.log(`[Aperture Agent Service] Running on port ${port}`);
  console.log(`[Aperture Agent Service] Operator: ${agentConfig.operatorId}`);
});

function gracefulShutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down`);
  agent.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
