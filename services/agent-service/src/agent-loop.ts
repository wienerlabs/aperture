import crypto from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

const VERIFIER_PROGRAM = new PublicKey('AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU');
const VERIFY_BATCH_DISCRIMINATOR = Buffer.from([85, 129, 17, 164, 94, 99, 86, 45]);

function sha256(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return new Uint8Array(crypto.createHash('sha256').update(input).digest());
}

function hexToBytes32(hex: string): Uint8Array {
  const bytes = new Uint8Array(32);
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16) || 0;
  }
  return bytes;
}

function writeBorshVec(data: Uint8Array): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(data.length, 0);
  return Buffer.concat([lenBuf, Buffer.from(data)]);
}

function buildVerifyBatchAttestationIx(
  operator: PublicKey,
  batchHashBytes: Uint8Array,
  journalDigestBytes: Uint8Array,
  totalPayments: number,
  periodStart: bigint,
  periodEnd: bigint,
  receiptData: Uint8Array,
): TransactionInstruction {
  const [attestationRecordPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), operator.toBuffer(), batchHashBytes],
    VERIFIER_PROGRAM,
  );

  const receiptVec = writeBorshVec(receiptData);
  // disc[8] + batch_hash[32] + image_id[32] + journal_digest[32] + total_payments[4] + period_start[8] + period_end[8] + receipt_data
  const data = Buffer.alloc(8 + 32 + 32 + 32 + 4 + 8 + 8 + receiptVec.length);
  let offset = 0;

  VERIFY_BATCH_DISCRIMINATOR.copy(data, offset); offset += 8;
  Buffer.from(batchHashBytes).copy(data, offset); offset += 32;
  // image_id: [u32; 8] - use zeros for batch attestation (no RISC Zero image)
  offset += 32;
  Buffer.from(journalDigestBytes).copy(data, offset); offset += 32;
  data.writeUInt32LE(totalPayments, offset); offset += 4;
  data.writeBigInt64LE(periodStart, offset); offset += 8;
  data.writeBigInt64LE(periodEnd, offset); offset += 8;
  receiptVec.copy(data, offset);

  return new TransactionInstruction({
    programId: VERIFIER_PROGRAM,
    keys: [
      { pubkey: attestationRecordPDA, isSigner: false, isWritable: true },
      { pubkey: operator, isSigner: true, isWritable: false },
      { pubkey: operator, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface AgentConfig {
  readonly wallet: Keypair;
  readonly operatorId: string;
  readonly solanaRpcUrl: string;
  readonly policyServiceUrl: string;
  readonly complianceApiUrl: string;
  readonly proverServiceUrl: string;
  readonly stripeSecretKey: string;
  readonly usdcMint: string;
  readonly intervalMs: number;
}

export interface ActivityRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly type: 'x402' | 'mpp' | 'attestation' | 'policy_check' | 'zk_proof' | 'error';
  readonly message: string;
  readonly proofHash: string | null;
  readonly txSignature: string | null;
  readonly paymentIntentId: string | null;
  readonly success: boolean;
}

export interface AgentStats {
  readonly totalX402: number;
  readonly totalMpp: number;
  readonly totalProofs: number;
  readonly totalViolations: number;
  readonly totalUsdcSpent: number;
  readonly totalMppSpent: number;
  readonly totalSessions: number;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Aperture Agent] ${msg}`);
}

export class AgentLoop {
  private readonly config: AgentConfig;
  private readonly connection: Connection;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly activity: ActivityRecord[] = [];
  private readonly stats: AgentStats = {
    totalX402: 0,
    totalMpp: 0,
    totalProofs: 0,
    totalViolations: 0,
    totalUsdcSpent: 0,
    totalMppSpent: 0,
    totalSessions: 0,
  };

  constructor(config: AgentConfig) {
    this.config = config;
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
  }

  isRunning(): boolean {
    return this.running;
  }

  getActivity(): readonly ActivityRecord[] {
    return this.activity;
  }

  getStats(): AgentStats {
    return this.stats;
  }

  getLastActivity(): string | null {
    return this.activity.length > 0 ? this.activity[0].timestamp : null;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    log('Agent started');
    this.pushActivity('policy_check', 'Agent started', true);

    // Run first cycle immediately, then chain: wait -> cycle -> wait -> cycle
    this.runLoopOnce();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    log('Agent stopped');
    this.pushActivity('policy_check', 'Agent stopped', true);
  }

  private async runLoopOnce(): Promise<void> {
    if (!this.running) return;
    await this.runCycle();
    if (!this.running) return;
    // Wait full interval AFTER cycle completes, then run next
    log(`Waiting ${this.config.intervalMs / 1000}s before next cycle...`);
    this.timer = setTimeout(() => this.runLoopOnce(), this.config.intervalMs);
  }

  private pushActivity(
    type: ActivityRecord['type'],
    message: string,
    success: boolean,
    extra?: { proofHash?: string; txSignature?: string; paymentIntentId?: string },
  ): void {
    const record: ActivityRecord = {
      id: uid(),
      timestamp: new Date().toISOString(),
      type,
      message,
      proofHash: extra?.proofHash ?? null,
      txSignature: extra?.txSignature ?? null,
      paymentIntentId: extra?.paymentIntentId ?? null,
      success,
    };
    this.activity.unshift(record);
    // Keep last 200 records
    if (this.activity.length > 200) this.activity.length = 200;
  }

  // Link a prior zk_proof activity row to the payment TX that anchored it on-chain.
  private attachTxToZkProof(proofHash: string, txSignature: string): void {
    const idx = this.activity.findIndex((a) => a.type === 'zk_proof' && a.proofHash === proofHash && a.txSignature === null);
    if (idx === -1) return;
    const existing = this.activity[idx]!;
    this.activity[idx] = { ...existing, txSignature };
  }

  private mutStats(fn: (s: AgentStats) => Partial<AgentStats>): void {
    const patch = fn(this.stats);
    Object.assign(this.stats, patch);
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    // cycle running
    this.mutStats(() => ({ totalSessions: this.stats.totalSessions + 1 }));
    log('--- Cycle start ---');

    try {
      // 1. Load policy
      const policy = await this.loadPolicy();
      if (!policy) {
        // cycle done
        return;
      }

      // 2. x402 flow
      await this.runX402Flow(policy);

      // 3. MPP flow
      await this.runMPPFlow(policy);

      // 4. Batch attestation
      await this.createAttestation();

      log('--- Cycle complete ---');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Cycle error: ${msg}`);
      this.pushActivity('error', msg, false);
    } finally {
      // cycle done
    }
  }

  private async loadPolicy(): Promise<{
    id: string;
    compiled: Record<string, unknown>;
    maxPerTxLamports: number;
    allowedCategories: readonly string[];
    blockedAddresses: readonly string[];
    tokenWhitelist: readonly string[];
    maxDailyLamports: number;
  } | null> {
    log('Loading policy...');
    const { policyServiceUrl, operatorId } = this.config;

    const listRes = await fetch(
      `${policyServiceUrl}/api/v1/policies/operator/${operatorId}?page=1&limit=1`,
    );
    if (!listRes.ok) {
      this.pushActivity('error', `Policy fetch failed: HTTP ${listRes.status}`, false);
      return null;
    }

    const listBody = (await listRes.json()) as {
      data: { id: string; max_daily_spend: number; max_per_transaction: number; allowed_endpoint_categories: string[]; blocked_addresses: string[]; token_whitelist: string[] }[];
    };
    if (listBody.data.length === 0) {
      this.pushActivity('error', 'No active policies found', false);
      return null;
    }

    const p = listBody.data[0];
    this.pushActivity('policy_check', `Policy loaded: max_tx=${p.max_per_transaction} USDC`, true);

    const compileRes = await fetch(
      `${policyServiceUrl}/api/v1/policies/${p.id}/compile`,
    );
    if (!compileRes.ok) {
      this.pushActivity('error', 'Policy compilation failed', false);
      return null;
    }
    const compileBody = (await compileRes.json()) as { data: Record<string, unknown> };

    return {
      id: p.id,
      compiled: compileBody.data,
      maxPerTxLamports: p.max_per_transaction * 1_000_000,
      maxDailyLamports: p.max_daily_spend * 1_000_000,
      allowedCategories: p.allowed_endpoint_categories,
      blockedAddresses: p.blocked_addresses,
      tokenWhitelist: p.token_whitelist,
    };
  }

  private checkPolicy(
    policy: { allowedCategories: readonly string[]; tokenWhitelist: readonly string[]; maxPerTxLamports: number },
    category: string,
    amountLamports: number,
  ): string | null {
    if (!policy.allowedCategories.includes(category)) {
      return `Category "${category}" not allowed`;
    }
    if (amountLamports > policy.maxPerTxLamports) {
      return `Amount exceeds max_per_transaction`;
    }
    if (!policy.tokenWhitelist.includes(this.config.usdcMint)) {
      return `Token not in whitelist`;
    }
    return null;
  }

  private async generateProof(
    compiled: Record<string, unknown>,
    amountLamports: number,
    category: string,
  ): Promise<{ proof_hash: string; is_compliant: boolean; amount_range_min: number; amount_range_max: number; verification_timestamp: string; image_id: string; receipt_bytes: number[] } | null> {
    log('Generating ZK proof...');
    const startMs = Date.now();

    // Check if prover service is reachable
    try {
      const healthRes = await fetch(`${this.config.proverServiceUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!healthRes.ok) throw new Error('unhealthy');
    } catch {
      this.pushActivity('error', `Prover service not reachable at ${this.config.proverServiceUrl}. Start the prover-service or configure PROVER_SERVICE_URL.`, false);
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000);

    let res: Response;
    try {
      res = await fetch(`${this.config.proverServiceUrl}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          policy_id: compiled.policy_id,
          operator_id: compiled.operator_id,
          max_daily_spend_lamports: parseInt(String(compiled.max_daily_spend_lamports), 10),
          max_per_transaction_lamports: parseInt(String(compiled.max_per_transaction_lamports), 10),
          allowed_endpoint_categories: compiled.allowed_endpoint_categories,
          blocked_addresses: compiled.blocked_addresses,
          token_whitelist: compiled.token_whitelist,
          payment_amount_lamports: amountLamports,
          payment_token_mint: this.config.usdcMint,
          payment_recipient: this.config.operatorId,
          payment_endpoint_category: category,
          payment_timestamp: new Date().toISOString(),
          daily_spent_so_far_lamports: Math.round(this.stats.totalUsdcSpent * 1_000_000),
        }),
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Connection failed';
      this.pushActivity('error', `Prover request failed: ${msg}`, false);
      return null;
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errBody = await res.text();
      this.pushActivity('error', `Prover error: ${errBody.slice(0, 100)}`, false);
      return null;
    }

    const proof = (await res.json()) as { proof_hash: string; is_compliant: boolean; amount_range_min: number; amount_range_max: number; verification_timestamp: string; image_id: string; receipt_bytes: number[] };
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    this.mutStats(() => ({ totalProofs: this.stats.totalProofs + 1 }));
    this.pushActivity('zk_proof', `ZK proof generated in ${elapsed}s`, true, { proofHash: proof.proof_hash });
    log(`ZK proof: ${proof.proof_hash} (${elapsed}s)`);
    return proof;
  }

  private async runX402Flow(policy: {
    id: string;
    compiled: Record<string, unknown>;
    allowedCategories: readonly string[];
    tokenWhitelist: readonly string[];
    maxPerTxLamports: number;
  }): Promise<void> {
    const amountLamports = 1_000_000;
    const violation = this.checkPolicy(policy, 'x402', amountLamports);
    if (violation) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity('x402', `BLOCKED: ${violation}`, false);
      return;
    }

    const proof = await this.generateProof(policy.compiled, amountLamports, 'x402');
    if (!proof) return;

    // x402 payment: GET -> 402 -> USDC transfer -> retry
    log('Paying via x402...');
    const endpoint = `${this.config.complianceApiUrl}/api/v1/compliance/protected-report?operator_id=${this.config.operatorId}`;

    const initialRes = await fetch(endpoint);
    if (initialRes.status !== 402) {
      this.pushActivity('error', `x402: expected 402, got ${initialRes.status}`, false);
      return;
    }

    const payBody = (await initialRes.json()) as { paymentRequirement?: { token: string; amount: string; recipient: string } };
    const req = payBody.paymentRequirement;
    if (!req) {
      this.pushActivity('error', 'x402: no paymentRequirement', false);
      return;
    }

    const usdcMint = new PublicKey(req.token);
    const recipient = new PublicKey(req.recipient);
    const payerAta = await getAssociatedTokenAddress(usdcMint, this.config.wallet.publicKey, false, TOKEN_PROGRAM_ID);
    const recipientAta = await getAssociatedTokenAddress(usdcMint, recipient, false, TOKEN_PROGRAM_ID);

    const transferIx = createTransferCheckedInstruction(payerAta, usdcMint, recipientAta, this.config.wallet.publicKey, parseInt(req.amount, 10), 6, [], TOKEN_PROGRAM_ID);
    const tx = new Transaction().add(transferIx);
    tx.feePayer = this.config.wallet.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(this.config.wallet);

    const txSig = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(txSig, 'confirmed');

    // Retry with payment header
    const proofHeader = Buffer.from(JSON.stringify({ txSignature: txSig, payer: this.config.wallet.publicKey.toBase58(), zkProofHash: proof.proof_hash })).toString('base64');
    const paidRes = await fetch(endpoint, { headers: { 'Content-Type': 'application/json', 'x-402-payment': proofHeader } });

    if (paidRes.ok) {
      this.mutStats(() => ({ totalX402: this.stats.totalX402 + 1, totalUsdcSpent: this.stats.totalUsdcSpent + 1 }));
      this.attachTxToZkProof(proof.proof_hash, txSig);
      this.pushActivity('x402', `1 USDC paid, verified on Solana`, true, { proofHash: proof.proof_hash, txSignature: txSig });
      log(`x402 TX: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

      // Submit proof record with tx_signature
      const paymentId = `agent-x402-${uid()}`;
      await this.submitProofRecord(paymentId, policy.id, proof, this.config.usdcMint, txSig);
    } else {
      this.pushActivity('error', `x402 retry failed: HTTP ${paidRes.status}`, false, { txSignature: txSig });
    }
  }

  private async runMPPFlow(policy: {
    id: string;
    compiled: Record<string, unknown>;
    allowedCategories: readonly string[];
    tokenWhitelist: readonly string[];
    maxPerTxLamports: number;
  }): Promise<void> {
    const amountLamports = 500_000;
    const violation = this.checkPolicy(policy, 'mpp', amountLamports);
    if (violation) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity('mpp', `BLOCKED: ${violation}`, false);
      return;
    }

    const proof = await this.generateProof(policy.compiled, amountLamports, 'mpp');
    if (!proof) return;

    // MPP payment: GET -> 402 -> Stripe confirm -> retry
    log('Paying via MPP...');
    const endpoint = `${this.config.complianceApiUrl}/api/v1/compliance/mpp-report?operator_id=${this.config.operatorId}`;

    const initialRes = await fetch(endpoint);
    if (initialRes.status !== 402) {
      this.pushActivity('error', `MPP: expected 402, got ${initialRes.status}`, false);
      return;
    }

    const challengeBody = (await initialRes.json()) as { mppChallenge?: { id: string; stripe: { paymentIntentId: string; clientSecret: string }; request: { amount: string; currency: string } } };
    const challenge = challengeBody.mppChallenge;
    if (!challenge) {
      this.pushActivity('error', 'MPP: no mppChallenge', false);
      return;
    }

    // Server-side Stripe confirm
    const confirmRes = await fetch(
      `https://api.stripe.com/v1/payment_intents/${challenge.stripe.paymentIntentId}/confirm`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.stripeSecretKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'payment_method=pm_card_visa',
      },
    );

    const pi = (await confirmRes.json()) as { id: string; status: string };
    if (pi.status !== 'succeeded') {
      this.pushActivity('error', `MPP Stripe status: ${pi.status}`, false, { paymentIntentId: pi.id });
      return;
    }

    // Retry with credential
    const credential = Buffer.from(JSON.stringify({ challengeId: challenge.id, paymentIntentId: pi.id })).toString('base64');
    const paidRes = await fetch(endpoint, { headers: { 'Content-Type': 'application/json', 'x-mpp-credential': credential } });

    if (paidRes.ok) {
      this.mutStats(() => ({ totalMpp: this.stats.totalMpp + 1, totalMppSpent: this.stats.totalMppSpent + 0.5 }));
      this.pushActivity('mpp', `$0.50 paid via Stripe`, true, { proofHash: proof.proof_hash, paymentIntentId: pi.id });
      log(`MPP PI: ${pi.id}`);

      const paymentId = `agent-mpp-${uid()}`;
      await this.submitProofRecord(paymentId, policy.id, proof, 'usd', null);
    } else {
      this.pushActivity('error', `MPP retry failed: HTTP ${paidRes.status}`, false, { paymentIntentId: pi.id });
    }
  }

  private async submitProofRecord(
    paymentId: string,
    policyId: string,
    proof: { proof_hash: string; is_compliant: boolean; amount_range_min: number; amount_range_max: number; verification_timestamp: string },
    tokenMint: string,
    txSignature: string | null,
  ): Promise<void> {
    // Create proof record
    const createRes = await fetch(`${this.config.complianceApiUrl}/api/v1/proofs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator_id: this.config.operatorId,
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

    if (!createRes.ok) return;

    const created = (await createRes.json()) as { data: { id: string } };
    if (txSignature) {
      await fetch(
        `${this.config.complianceApiUrl}/api/v1/proofs/${created.data.id}/tx-signature`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_signature: txSignature }),
        },
      );
      log(`  Proof record ${created.data.id} updated with TX: ${txSignature.slice(0, 20)}...`);
    }

    // Mint compressed attestation via Light Protocol
    if (proof.is_compliant) {
      try {
        const compressRes = await fetch(
          `${this.config.complianceApiUrl}/api/v1/compliance/compress-attestation`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proof_id: created.data.id,
              recipient: this.config.operatorId,
            }),
          },
        );
        if (compressRes.ok) {
          const compressData = (await compressRes.json()) as { data: { tx_signature: string } };
          log(`  Compressed attestation TX: ${compressData.data.tx_signature.slice(0, 20)}...`);
        }
      } catch {
        // Light Protocol not configured -- non-blocking
      }
    }
  }

  private async createAttestation(): Promise<void> {
    log('Creating batch attestation...');
    const periodStart = new Date(Date.now() - 60_000);
    const periodEnd = new Date();

    try {
      const res = await fetch(`${this.config.complianceApiUrl}/api/v1/attestations/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator_id: this.config.operatorId,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        }),
      });
      if (!res.ok) return;

      const attData = (await res.json()) as { data: { id: string; proof_hash: string; total_payments: number } };
      const att = attData.data;
      log(`  Attestation created: ${att.id}`);

      // Anchor on Solana via verify_batch_attestation
      log('  Anchoring attestation on Solana Devnet...');
      const batchHashBytes = hexToBytes32(att.proof_hash);
      const periodStartUnix = BigInt(Math.floor(periodStart.getTime() / 1000));
      const periodEndUnix = BigInt(Math.floor(periodEnd.getTime() / 1000));
      // Receipt payload carries batch_hash/total_payments/image_id for on-chain
      // cross-reference checks; keys must match extract_json_* in verify_batch.rs.
      // verify_batch.rs requires receipt_data == "batch:{hex}:{total}:{start}:{end}"
      // so that sha256(receipt_data) == journal_digest == compute_batch_digest(...).
      const batchHashHex = att.proof_hash.startsWith('0x') ? att.proof_hash.slice(2) : att.proof_hash;
      const digestInput = `batch:${batchHashHex}:${att.total_payments}:${periodStartUnix}:${periodEndUnix}`;
      const receiptBytes = new TextEncoder().encode(digestInput);
      const journalDigestBytes = sha256(receiptBytes);

      const ix = buildVerifyBatchAttestationIx(
        this.config.wallet.publicKey,
        batchHashBytes,
        journalDigestBytes,
        att.total_payments,
        periodStartUnix,
        periodEndUnix,
        receiptBytes,
      );

      const tx = new Transaction().add(ix);
      tx.feePayer = this.config.wallet.publicKey;
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(this.config.wallet);

      const txSig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(txSig, 'confirmed');

      log(`  Attestation anchored: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);

      // Save tx_signature to compliance API
      await fetch(
        `${this.config.complianceApiUrl}/api/v1/attestations/${att.id}/tx-signature`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_signature: txSig }),
        },
      );

      this.pushActivity('attestation', `Batch attestation anchored on Solana`, true, { proofHash: att.proof_hash, txSignature: txSig });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  Attestation error: ${msg}`);
      this.pushActivity('error', `Attestation failed: ${msg}`, false);
    }
  }
}
