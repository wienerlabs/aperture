import dotenv from 'dotenv';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Keypair } from '@solana/web3.js';
import { AgentLoop, type AgentConfig } from './agent-loop.js';

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
  usdcMint: process.env.USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  intervalMs: parseInt(process.env.AGENT_INTERVAL_MS ?? '30000', 10),
};

const agent = new AgentLoop(agentConfig);

const app = express();
const port = parseInt(process.env.AGENT_SERVICE_PORT ?? '3004', 10);

app.use(helmet());
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3333'],
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'agent-service', version: '0.1.0' });
});

app.get('/status', (_req, res) => {
  res.json({
    running: agent.isRunning(),
    operatorId: agentConfig.operatorId,
    lastActivity: agent.getLastActivity(),
    stats: agent.getStats(),
  });
});

app.get('/activity', (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
  const records = agent.getActivity().slice(0, limit);
  res.json({ success: true, data: records });
});

app.post('/start', async (_req, res) => {
  if (agent.isRunning()) {
    res.json({ success: true, message: 'Agent is already running' });
    return;
  }

  // Validate policy has required categories before starting
  try {
    const listRes = await fetch(
      `${agentConfig.policyServiceUrl}/api/v1/policies/operator/${agentConfig.operatorId}?page=1&limit=1`,
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

  agent.start();
  res.json({ success: true, message: 'Agent started' });
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
