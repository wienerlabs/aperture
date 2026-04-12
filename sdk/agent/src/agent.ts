import dotenv from 'dotenv';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { PolicyChecker } from './policy-checker.js';
import { ProverClient } from './prover-client.js';
import { X402Payer } from './x402-payer.js';
import { MPPPayer } from './mpp-payer.js';

// Load .env from agent dir, then project root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Aperture Agent] ${msg}`);
}

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

interface AgentConfig {
  readonly wallet: Keypair;
  readonly operatorId: string;
  readonly solanaRpcUrl: string;
  readonly policyServiceUrl: string;
  readonly complianceApiUrl: string;
  readonly proverServiceUrl: string;
  readonly stripeSecretKey: string;
  readonly usdcMint: string;
}

function loadConfig(): AgentConfig {
  const privateKeyRaw = requireEnv('AGENT_WALLET_PRIVATE_KEY');
  // Support JSON array [1,2,3,...] and base58 formats
  let secretKeyBytes: Uint8Array;
  if (privateKeyRaw.startsWith('[')) {
    secretKeyBytes = new Uint8Array(JSON.parse(privateKeyRaw) as number[]);
  } else {
    // base58 - decode manually (base58 alphabet)
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
  const operatorId = wallet.publicKey.toBase58();

  return {
    wallet,
    operatorId,
    solanaRpcUrl:
      process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    policyServiceUrl:
      process.env.POLICY_SERVICE_URL ?? 'http://localhost:3001',
    complianceApiUrl:
      process.env.COMPLIANCE_API_URL ?? 'http://localhost:3002',
    proverServiceUrl:
      process.env.PROVER_SERVICE_URL ?? 'http://localhost:3003',
    stripeSecretKey: requireEnv('STRIPE_SECRET_KEY'),
    usdcMint:
      process.env.USDC_MINT ??
      '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  };
}

async function submitProofRecord(
  complianceApiUrl: string,
  operatorId: string,
  policyId: string,
  paymentId: string,
  proof: {
    proof_hash: string;
    is_compliant: boolean;
    amount_range_min: number;
    amount_range_max: number;
    verification_timestamp: string;
  },
  tokenMint: string,
): Promise<string> {
  const res = await fetch(`${complianceApiUrl}/api/v1/proofs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operator_id: operatorId,
      policy_id: policyId,
      payment_id: paymentId,
      proof_hash: proof.proof_hash,
      amount_range_min: proof.amount_range_min / 1_000_000,
      amount_range_max: proof.amount_range_max / 1_000_000,
      token_mint: tokenMint,
      is_compliant: proof.is_compliant,
      verified_at: proof.verification_timestamp,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to submit proof record: ${body}`);
  }

  const data = (await res.json()) as { data: { id: string } };
  return data.data.id;
}

async function createBatchAttestation(
  complianceApiUrl: string,
  operatorId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ id: string; batch_proof_hash: string }> {
  const res = await fetch(`${complianceApiUrl}/api/v1/attestations/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operator_id: operatorId,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create batch attestation: ${body}`);
  }

  const data = (await res.json()) as {
    data: { id: string; proof_hash: string };
  };
  return { id: data.data.id, batch_proof_hash: data.data.proof_hash };
}

async function run(): Promise<void> {
  log('========================================');
  log('Aperture Autonomous Agent starting...');
  log('========================================');

  const cfg = loadConfig();
  log(`Operator wallet: ${cfg.operatorId}`);
  log(`Solana RPC: ${cfg.solanaRpcUrl}`);

  // Initialize components
  const policyChecker = new PolicyChecker(cfg.policyServiceUrl);
  const prover = new ProverClient(cfg.proverServiceUrl);
  const x402Payer = new X402Payer(
    cfg.solanaRpcUrl,
    cfg.wallet,
    cfg.complianceApiUrl,
  );
  const mppPayer = new MPPPayer(cfg.complianceApiUrl, cfg.stripeSecretKey);

  // Health checks
  log('Checking service health...');
  const proverHealthy = await prover.healthCheck();
  if (!proverHealthy) {
    throw new Error(
      `Prover service not reachable at ${cfg.proverServiceUrl}`,
    );
  }
  log('All services healthy');

  // ===== STEP 1: Load policy =====
  const policy = await policyChecker.loadPolicy(cfg.operatorId);
  const compiled = policyChecker.getCompiled();
  if (!compiled) throw new Error('Policy compilation failed');

  let totalViolations = 0;
  const sessionStart = new Date();
  const proofRecordIds: string[] = [];

  // ===== STEP 2: x402 payment flow =====
  log('');
  log('--- x402 Payment Flow ---');

  const x402AmountLamports = 1_000_000; // 1 USDC
  const x402Check = policyChecker.checkPayment({
    amountLamports: x402AmountLamports,
    tokenMint: cfg.usdcMint,
    recipient: cfg.operatorId,
    endpointCategory: 'x402',
  });

  if (!x402Check.passed) {
    log(`x402 payment BLOCKED by policy: ${x402Check.violations.join('; ')}`);
    totalViolations += x402Check.violations.length;
  } else {
    // Generate ZK proof before payment
    const x402Proof = await prover.generateProof(
      compiled,
      x402AmountLamports,
      cfg.usdcMint,
      cfg.operatorId,
      'x402',
      policyChecker.getDailySpent(),
    );

    // Execute x402 payment
    const x402Result = await x402Payer.payForReport(
      cfg.operatorId,
      x402Proof.proof_hash,
    );

    if (x402Result.success) {
      policyChecker.recordSpend(x402AmountLamports);

      // Submit proof record
      log('Submitting x402 proof record to compliance API...');
      const paymentId = `agent-x402-${Date.now()}`;
      const recordId = await submitProofRecord(
        cfg.complianceApiUrl,
        cfg.operatorId,
        policy.id,
        paymentId,
        x402Proof,
        cfg.usdcMint,
      );
      proofRecordIds.push(recordId);
      log(`  Proof record saved: ${recordId}`);
    } else {
      log(`x402 payment failed: ${x402Result.error}`);
    }
  }

  // ===== STEP 3: MPP payment flow =====
  log('');
  log('--- MPP Payment Flow ---');

  const mppAmountLamports = 500_000; // $0.50 = 0.5 USDC equivalent
  const mppCheck = policyChecker.checkPayment({
    amountLamports: mppAmountLamports,
    tokenMint: cfg.usdcMint,
    recipient: cfg.operatorId,
    endpointCategory: 'mpp',
  });

  if (!mppCheck.passed) {
    log(`MPP payment BLOCKED by policy: ${mppCheck.violations.join('; ')}`);
    totalViolations += mppCheck.violations.length;
  } else {
    // Generate ZK proof before payment
    const mppProof = await prover.generateProof(
      compiled,
      mppAmountLamports,
      cfg.usdcMint,
      cfg.operatorId,
      'mpp',
      policyChecker.getDailySpent(),
    );

    // Execute MPP payment
    const mppResult = await mppPayer.payForReport(cfg.operatorId);

    if (mppResult.success) {
      policyChecker.recordSpend(mppAmountLamports);

      // Submit proof record
      log('Submitting MPP proof record to compliance API...');
      const paymentId = `agent-mpp-${Date.now()}`;
      const recordId = await submitProofRecord(
        cfg.complianceApiUrl,
        cfg.operatorId,
        policy.id,
        paymentId,
        mppProof,
        'usd',
      );
      proofRecordIds.push(recordId);
      log(`  Proof record saved: ${recordId}`);
    } else {
      log(`MPP payment failed: ${mppResult.error}`);
    }
  }

  // ===== STEP 4: Batch attestation =====
  log('');
  log('--- Data Contribution ---');

  if (proofRecordIds.length > 0) {
    log('Creating batch attestation...');
    try {
      const attestation = await createBatchAttestation(
        cfg.complianceApiUrl,
        cfg.operatorId,
        sessionStart,
        new Date(),
      );
      log(`  Attestation created: ${attestation.id}`);
      log(`  Batch proof hash: ${attestation.batch_proof_hash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  Attestation creation failed: ${msg}`);
    }
  } else {
    log('No proof records to attest (all payments were blocked or failed)');
  }

  // ===== Summary =====
  log('');
  log('========================================');
  log('Session complete');
  log(`  Payments attempted: 2`);
  log(`  Proof records submitted: ${proofRecordIds.length}`);
  log(
    `  Daily spend: ${(policyChecker.getDailySpent() / 1_000_000).toFixed(2)} USDC`,
  );
  log(`  Policy violations: ${totalViolations}`);
  log('========================================');
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  log(`FATAL: ${msg}`);
  process.exit(1);
});
