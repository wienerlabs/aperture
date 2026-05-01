import crypto from 'crypto';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  buildVerifyPaymentProofV2WithTransferIx,
  buildVerifyMppPaymentProofIx,
  buildEd25519VerifyIx,
  deriveOperatorPDA,
  derivePolicyPDA,
  deriveProofRecordPDA,
  readEffectiveDailySpentLamports,
  VERIFIER_PROGRAM,
} from './anchor-helpers.js';
import bs58 from 'bs58';

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
  const data = Buffer.alloc(8 + 32 + 32 + 32 + 4 + 8 + 8 + receiptVec.length);
  let offset = 0;

  VERIFY_BATCH_DISCRIMINATOR.copy(data, offset); offset += 8;
  Buffer.from(batchHashBytes).copy(data, offset); offset += 32;
  offset += 32; // image_id all zeros for batch attestation
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
  /// Address Lookup Table that hosts the static program IDs the x402
  /// flow references (Token-2022, Verifier, PolicyRegistry, Transfer
  /// Hook, ATA program, System). Lets the V0 message reference each as
  /// a 1-byte index instead of 32-byte pubkey, shaving ~155 bytes off
  /// the verify+transfer bundle so it fits the 1232-byte tx limit.
  readonly x402LookupTable: string | null;
  /// aUSDC mint (SPL Token-2022 with the Aperture transfer-hook attached).
  /// Production payments MUST go through this mint so the hook can enforce
  /// compliance; plain USDC bypasses every on-chain guarantee.
  readonly ausdcMint: string;
  /// Stripe Customer ID + saved PaymentMethod ID the agent uses for MPP
  /// (off_session) charges. Provisioned manually by the operator: a one-time
  /// Stripe Customers.create + PaymentMethods.attach + setup_future_usage
  /// confirmation. Both are optional — when either is unset the MPP cycle
  /// is skipped instead of failing.
  readonly stripeCustomerId: string | null;
  readonly stripePaymentMethodId: string | null;
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
  // Display-only counters: the authoritative on-chain spend lives in
  // OperatorState.daily_spent_lamports; the agent never trusts these.
  readonly totalUsdcSpent: number;
  readonly totalMppSpent: number;
  readonly totalSessions: number;
}

interface CompiledPolicy {
  readonly policy_id: string;
  readonly operator_id: string;
  readonly max_daily_spend_lamports: string;
  readonly max_per_transaction_lamports: string;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly token_whitelist: readonly string[];
  readonly time_restrictions: ReadonlyArray<{
    readonly allowed_days: readonly string[];
    readonly allowed_hours_start: number;
    readonly allowed_hours_end: number;
    readonly timezone: string;
  }>;
}

interface ProverResponse {
  readonly is_compliant: boolean;
  readonly policy_data_hash: string;
  readonly policy_data_hash_hex: string;
  readonly proof_hash: string;
  readonly verification_timestamp: string;
  readonly proving_time_ms?: number;
  readonly groth16: {
    readonly proof_a: string;
    readonly proof_b: string;
    readonly proof_c: string;
    readonly public_inputs: readonly string[];
  };
  readonly public_signals: {
    readonly amount_lamports: string;
    readonly daily_spent_before: string;
    readonly current_unix_timestamp: string;
  };
}

function uid(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
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
  private activeOperatorId: string;
  private readonly activity: ActivityRecord[] = [];
  private cachedAlt: AddressLookupTableAccount | null = null;
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
    this.activeOperatorId = config.operatorId;
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
  }

  isRunning(): boolean { return this.running; }
  getActivity(): readonly ActivityRecord[] { return this.activity; }
  getStats(): AgentStats { return this.stats; }
  getLastActivity(): string | null {
    return this.activity.length > 0 ? this.activity[0].timestamp : null;
  }
  getActiveOperatorId(): string { return this.activeOperatorId; }

  start(operatorId?: string): void {
    if (this.running) return;
    if (operatorId) this.activeOperatorId = operatorId;
    this.running = true;
    log(`Agent started (operator=${this.activeOperatorId})`);
    this.pushActivity('policy_check', 'Agent started', true);
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
    if (this.activity.length > 200) this.activity.length = 200;
  }

  private mutStats(fn: (s: AgentStats) => Partial<AgentStats>): void {
    const patch = fn(this.stats);
    Object.assign(this.stats, patch);
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    this.mutStats(() => ({ totalSessions: this.stats.totalSessions + 1 }));
    log('--- Cycle start ---');

    try {
      const policy = await this.loadPolicy();
      if (!policy || !this.running) return;

      await this.runX402Flow(policy);
      if (!this.running) return;

      const stripeCreds = await this.resolveStripeCredentials();
      if (stripeCreds) {
        await this.runMppFlow(policy, stripeCreds);
      } else {
        log(
          'Skipping MPP flow — no saved Stripe credentials for this operator (configure from dashboard Settings → Agent Stripe Configuration).',
        );
      }
      if (!this.running) return;

      await this.createAttestation();
      log('--- Cycle complete ---');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Cycle error: ${msg}`);
      this.pushActivity('error', msg, false);
    }
  }

  /**
   * Resolves the Stripe Customer + PaymentMethod the agent should charge
   * during this cycle. Priority:
   *   1. compliance-api /agent/stripe/credentials/:operatorId (dashboard-saved)
   *   2. process env (legacy fallback for ops who set STRIPE_CUSTOMER_ID +
   *      STRIPE_PAYMENT_METHOD_ID directly in docker-compose)
   * Returns null when neither produces a usable pair, signaling that the
   * MPP cycle should be skipped.
   */
  /**
   * (Unused) Fetches the x402 Address Lookup Table once per process. Kept
   * around for future VersionedTransaction-based flows; the current x402
   * ix is a single Anchor instruction whose legacy tx serialization is
   * already under the 1232-byte limit, so no ALT is needed.
   */
  // @ts-expect-error keep for future use
  private async resolveLookupTable(): Promise<AddressLookupTableAccount | null> {
    if (this.cachedAlt) return this.cachedAlt;
    if (!this.config.x402LookupTable) return null;
    try {
      const altPubkey = new PublicKey(this.config.x402LookupTable);
      const res = await this.connection.getAddressLookupTable(altPubkey);
      if (!res.value) {
        log(`x402 ALT ${altPubkey.toBase58()} not found on-chain`);
        return null;
      }
      this.cachedAlt = res.value;
      log(
        `x402 ALT loaded: ${altPubkey.toBase58()} (${res.value.state.addresses.length} entries)`,
      );
      return this.cachedAlt;
    } catch (err) {
      log(
        `x402 ALT fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async resolveStripeCredentials(): Promise<{
    customerId: string;
    paymentMethodId: string;
  } | null> {
    try {
      const res = await fetch(
        `${this.config.complianceApiUrl}/api/v1/agent/stripe/credentials/${this.activeOperatorId}`,
      );
      if (res.ok) {
        const body = (await res.json()) as {
          data: { stripe_customer_id: string; stripe_payment_method_id: string };
        };
        return {
          customerId: body.data.stripe_customer_id,
          paymentMethodId: body.data.stripe_payment_method_id,
        };
      }
      if (res.status !== 404) {
        log(
          `Stripe credentials lookup returned HTTP ${res.status}; falling back to env.`,
        );
      }
    } catch (err) {
      log(
        `Stripe credentials lookup failed: ${err instanceof Error ? err.message : String(err)}; falling back to env.`,
      );
    }
    if (this.config.stripeCustomerId && this.config.stripePaymentMethodId) {
      return {
        customerId: this.config.stripeCustomerId,
        paymentMethodId: this.config.stripePaymentMethodId,
      };
    }
    return null;
  }

  private async loadPolicy(): Promise<{
    id: string;
    compiled: CompiledPolicy;
    onchainPda: string;
    onchainStatus: string;
    maxPerTxLamports: number;
    allowedCategories: readonly string[];
    blockedAddresses: readonly string[];
    tokenWhitelist: readonly string[];
  } | null> {
    log('Loading policy...');
    const { policyServiceUrl } = this.config;
    const operatorId = this.activeOperatorId;

    const listRes = await fetch(
      `${policyServiceUrl}/api/v1/policies/operator/${operatorId}?page=1&limit=1`,
    );
    if (!listRes.ok) {
      this.pushActivity('error', `Policy fetch failed: HTTP ${listRes.status}`, false);
      return null;
    }
    const listBody = (await listRes.json()) as {
      data: ReadonlyArray<{
        readonly id: string;
        readonly max_per_transaction: number;
        readonly allowed_endpoint_categories: readonly string[];
        readonly blocked_addresses: readonly string[];
        readonly token_whitelist: readonly string[];
        readonly onchain_pda: string | null;
        readonly onchain_status: string;
      }>;
    };
    if (listBody.data.length === 0) {
      this.pushActivity('error', 'No active policies found', false);
      return null;
    }
    const p = listBody.data[0];

    if (p.onchain_status !== 'registered' || !p.onchain_pda) {
      this.pushActivity(
        'error',
        `Policy ${p.id} is not anchored on-chain (status=${p.onchain_status}). Run "Anchor on-chain" from the dashboard before the agent can use it.`,
        false,
      );
      return null;
    }

    const compileRes = await fetch(`${policyServiceUrl}/api/v1/policies/${p.id}/compile`);
    if (!compileRes.ok) {
      this.pushActivity('error', 'Policy compilation failed', false);
      return null;
    }
    const compileBody = (await compileRes.json()) as { data: CompiledPolicy };

    this.pushActivity(
      'policy_check',
      `Policy ${p.id} loaded (max_tx=${p.max_per_transaction} USDC, anchored=${p.onchain_pda.slice(0, 8)}…)`,
      true,
    );

    return {
      id: p.id,
      compiled: compileBody.data,
      onchainPda: p.onchain_pda,
      onchainStatus: p.onchain_status,
      maxPerTxLamports: p.max_per_transaction * 1_000_000,
      allowedCategories: p.allowed_endpoint_categories,
      blockedAddresses: p.blocked_addresses,
      tokenWhitelist: p.token_whitelist,
    };
  }

  /**
   * Asks prover-service for a proof bound to the EXACT transfer parameters
   * that will hit the chain. Recipient, amount, mint and daily_spent come
   * from real sources (the 402 challenge + on-chain OperatorState); none
   * of them are made up by the agent.
   */
  private async generateProof(
    compiled: CompiledPolicy,
    paymentRecipient: string,
    paymentTokenMint: string,
    paymentAmountLamports: number,
    paymentEndpointCategory: string,
    dailySpentBeforeLamports: bigint,
    currentUnixTimestamp: number,
    stripeReceiptHashDecimal: string = '0',
  ): Promise<ProverResponse | null> {
    log('Generating ZK proof…');
    const startMs = Date.now();

    try {
      const healthRes = await fetch(`${this.config.proverServiceUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!healthRes.ok) throw new Error('unhealthy');
    } catch {
      this.pushActivity(
        'error',
        `Prover service not reachable at ${this.config.proverServiceUrl}.`,
        false,
      );
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
          max_daily_spend_lamports: parseInt(compiled.max_daily_spend_lamports, 10),
          max_per_transaction_lamports: parseInt(compiled.max_per_transaction_lamports, 10),
          allowed_endpoint_categories: compiled.allowed_endpoint_categories,
          blocked_addresses: compiled.blocked_addresses,
          token_whitelist: compiled.token_whitelist,
          time_restrictions: compiled.time_restrictions,
          payment_amount_lamports: paymentAmountLamports,
          payment_token_mint: paymentTokenMint,
          payment_recipient: paymentRecipient,
          payment_endpoint_category: paymentEndpointCategory,
          daily_spent_before_lamports: dailySpentBeforeLamports.toString(),
          current_unix_timestamp: currentUnixTimestamp,
          stripe_receipt_hash: stripeReceiptHashDecimal,
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
      this.pushActivity('error', `Prover error: ${errBody.slice(0, 200)}`, false);
      return null;
    }

    const proof = (await res.json()) as ProverResponse;
    if (!proof.is_compliant) {
      this.pushActivity(
        'error',
        `Proof returned is_compliant=false — policy violated for this payment`,
        false,
      );
      return null;
    }

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    this.mutStats(() => ({ totalProofs: this.stats.totalProofs + 1 }));
    this.pushActivity('zk_proof', `ZK proof generated in ${elapsed}s`, true, {
      proofHash: proof.policy_data_hash_hex,
    });
    log(`ZK proof: ${proof.policy_data_hash_hex} (${elapsed}s)`);
    return proof;
  }

  /**
   * Runs the full x402 + ZK + on-chain transfer flow against the real
   * compliance-api endpoint:
   *
   *   1. GET endpoint, server returns HTTP 402 with paymentRequirement
   *      describing the actual recipient/amount/mint.
   *   2. Read OperatorState PDA so the proof's daily_spent_before matches
   *      whatever the verifier will see at submit time.
   *   3. POST /prove with those real values + the current Solana clock
   *      timestamp. Prover returns 9 public outputs.
   *   4. Build a single transaction containing:
   *        - verify_payment_proof_v2 (anchors the proof + sets pending hash)
   *        - SPL Token-2022 transferCheckedWithTransferHook (the hook
   *          intercepts, matches the proof, and CPIs record_payment to
   *          atomically advance daily_spent).
   *   5. Confirm. The retry GET against the endpoint then unlocks the
   *      protected report.
   */
  private async runX402Flow(policy: {
    id: string;
    compiled: CompiledPolicy;
    onchainPda: string;
    allowedCategories: readonly string[];
    tokenWhitelist: readonly string[];
    maxPerTxLamports: number;
  }): Promise<void> {
    const operatorId = this.activeOperatorId;
    const endpoint = `${this.config.complianceApiUrl}/api/v1/compliance/protected-report?operator_id=${operatorId}`;

    // ---- 1. 402 challenge ------------------------------------------------
    const initialRes = await fetch(endpoint);
    if (initialRes.status !== 402) {
      this.pushActivity('error', `x402: expected 402, got ${initialRes.status}`, false);
      return;
    }
    const payBody = (await initialRes.json()) as {
      readonly paymentRequirement?: {
        readonly token: string;
        readonly amount: string;
        readonly recipient: string;
      };
    };
    const req = payBody.paymentRequirement;
    if (!req) {
      this.pushActivity('error', 'x402: no paymentRequirement in challenge', false);
      return;
    }

    const paymentRecipient = req.recipient;
    const paymentTokenMint = req.token;
    const amountLamports = parseInt(req.amount, 10);

    // x402 supports any SPL token (USDC, USDT, aUSDC, …) the operator's
    // policy whitelists. Compliance is enforced inside the atomic Anchor
    // verify_payment_proof_v2_with_transfer ix (ZK proof + recipient/mint/
    // amount byte-binding + daily_spent ceiling), not via a transfer-hook
    // on the mint. The mint just needs to be on the policy's whitelist;
    // the Anchor handler picks up Token-1 (USDC/USDT) or Token-2022
    // (aUSDC) transparently from the mint account's program owner.
    if (!policy.tokenWhitelist.includes(paymentTokenMint)) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity(
        'x402',
        `BLOCKED: token ${paymentTokenMint} not on policy whitelist`,
        false,
      );
      return;
    }

    if (amountLamports > policy.maxPerTxLamports) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity('x402', `BLOCKED: amount ${amountLamports} exceeds max_per_tx`, false);
      return;
    }
    if (!policy.allowedCategories.includes('x402')) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity('x402', `BLOCKED: category "x402" not allowed`, false);
      return;
    }
    if (!policy.tokenWhitelist.includes(paymentTokenMint)) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity('x402', `BLOCKED: token ${paymentTokenMint} not whitelisted`, false);
      return;
    }

    // ---- 2. on-chain daily_spent + current timestamp --------------------
    const operator = this.config.wallet.publicKey;
    const dailySpentBefore = await readEffectiveDailySpentLamports(this.connection, operator);
    const nowUnix = Math.floor(Date.now() / 1000);

    // ---- 3. Prove --------------------------------------------------------
    const proof = await this.generateProof(
      policy.compiled,
      paymentRecipient,
      paymentTokenMint,
      amountLamports,
      'x402',
      dailySpentBefore,
      nowUnix,
    );
    if (!proof) return;

    // ---- 4. Build verify_payment_proof_v2 + Token-2022 transfer in one tx
    const policyIdBytes = sha256(policy.id);
    const [operatorAccount] = deriveOperatorPDA(operator);
    const [policyAccount] = derivePolicyPDA(operatorAccount, policyIdBytes);
    if (policyAccount.toBase58() !== policy.onchainPda) {
      this.pushActivity(
        'error',
        `Derived policy PDA ${policyAccount.toBase58()} does not match DB record ${policy.onchainPda}. Re-anchor the policy from the dashboard.`,
        false,
      );
      return;
    }

    const proofA = Uint8Array.from(Buffer.from(proof.groth16.proof_a, 'base64'));
    const proofB = Uint8Array.from(Buffer.from(proof.groth16.proof_b, 'base64'));
    const proofC = Uint8Array.from(Buffer.from(proof.groth16.proof_c, 'base64'));
    const publicInputs = proof.groth16.public_inputs.map((b64) =>
      Uint8Array.from(Buffer.from(b64, 'base64')),
    );

    const mintPubkey = new PublicKey(paymentTokenMint);
    const recipientPubkey = new PublicKey(paymentRecipient);

    // Token program is decided by the mint account's owner: SPL Token
    // (Token-1) for Circle USDC / USDT / most stablecoins, SPL Token-2022
    // for mints with extensions (Aperture's own aUSDC). The Anchor
    // verify_payment_proof_v2_with_transfer ix accepts both and forwards
    // its CPI to whichever the mint declares.
    const mintInfo = await this.connection.getAccountInfo(mintPubkey, 'confirmed');
    if (!mintInfo) {
      this.pushActivity('error', `Mint ${paymentTokenMint} not found on-chain`, false);
      return;
    }
    const tokenProgramId = mintInfo.owner;
    const isToken2022 = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID);
    const isToken1 = tokenProgramId.equals(TOKEN_PROGRAM_ID);
    if (!isToken1 && !isToken2022) {
      this.pushActivity(
        'error',
        `Mint ${paymentTokenMint} is owned by ${tokenProgramId.toBase58()}, not a known token program`,
        false,
      );
      return;
    }

    const sourceAta = await getAssociatedTokenAddress(
      mintPubkey,
      operator,
      false,
      tokenProgramId,
    );
    const destAta = await getAssociatedTokenAddress(
      mintPubkey,
      recipientPubkey,
      false,
      tokenProgramId,
    );

    // Treasury ATA must exist before the transfer.
    const destAtaInfo = await this.connection.getAccountInfo(destAta, 'confirmed');
    if (!destAtaInfo) {
      log('Recipient ATA missing, creating it first');
      const ataIx = createAssociatedTokenAccountIdempotentInstruction(
        operator,
        destAta,
        recipientPubkey,
        mintPubkey,
        tokenProgramId,
      );
      const ataTx = new Transaction().add(ataIx);
      ataTx.feePayer = operator;
      ataTx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      ataTx.sign(this.config.wallet);
      try {
        const ataSig = await this.connection.sendRawTransaction(ataTx.serialize());
        await this.connection.confirmTransaction(ataSig, 'confirmed');
        log(`Recipient ATA created: ${ataSig}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'ATA tx failed';
        this.pushActivity('error', `ATA create failed: ${msg}`, false);
        return;
      }
    }

    // Adım 9 — single atomic Anchor ix that:
    //   (a) Groth16-verifies the proof,
    //   (b) byte-binds recipient/mint/amount to the actual transfer,
    //   (c) bumps OperatorState.daily_spent + marks ProofRecord consumed,
    //   (d) CPIs the appropriate token program's transferChecked.
    // For Token-1 mints (USDC, USDT) no transfer-hook fires, so no
    // remaining_accounts are needed. For Token-2022 mints with the
    // TransferHook extension we'd need to resolve the hook accounts; the
    // current default mint is hook-free USDC so we skip that branch.
    const verifyWithTransferIx = buildVerifyPaymentProofV2WithTransferIx({
      operator,
      payer: operator,
      policyAccount,
      operatorAccount,
      sourceTokenAccount: sourceAta,
      destinationTokenAccount: destAta,
      mint: mintPubkey,
      tokenProgram: tokenProgramId,
      proofA,
      proofB,
      proofC,
      publicInputs,
      transferAmount: BigInt(amountLamports),
    });

    const tx = new Transaction().add(verifyWithTransferIx);
    tx.feePayer = operator;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(this.config.wallet);
    const serialized = tx.serialize();
    log(`x402 atomic tx serialized: ${serialized.length} bytes`);

    let txSig: string;
    try {
      txSig = await this.connection.sendRawTransaction(serialized);
      await this.connection.confirmTransaction(txSig, 'confirmed');
    } catch (err) {
      const errObj = err as Record<string, unknown> & { message?: string };
      const fullMsg =
        errObj?.message ??
        (typeof err === 'string' ? err : JSON.stringify(err, null, 2));
      log(`x402 tx failure (full): ${fullMsg}`);
      log(`x402 tx failure (raw): ${JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}))}`);
      const compact = String(fullMsg)
        .split(/Message:|base64/i)[0]
        .trim()
        .slice(0, 300);
      this.pushActivity('error', `x402 tx failed: ${compact}`, false);
      return;
    }

    log(`x402 tx confirmed: ${txSig}`);
    // Display label is decided by the mint pubkey: known stablecoins get
    // their human-readable ticker, anything else falls back to a short
    // truncation of the mint address. Production-realistic display so
    // operators eyeballing the activity feed can spot which rail fired.
    const tokenLabel = (() => {
      const m = paymentTokenMint;
      if (m === '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') return 'USDC';
      if (m === '92rsgTRBkCt16wMXFGEujHpj4WLpixoWRkP6wrLVooSm') return 'USDT';
      if (m === 'E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar') return 'aUSDC';
      return `${m.slice(0, 4)}…`;
    })();
    this.pushActivity('x402', `${amountLamports / 1_000_000} ${tokenLabel} paid + verified on-chain`, true, {
      proofHash: proof.policy_data_hash_hex,
      txSignature: txSig,
    });
    this.mutStats(() => ({
      totalX402: this.stats.totalX402 + 1,
      totalUsdcSpent: this.stats.totalUsdcSpent + amountLamports / 1_000_000,
    }));

    // ---- 5. Replay GET with payment header to unlock the protected report
    const proofHeader = Buffer.from(
      JSON.stringify({
        txSignature: txSig,
        payer: operator.toBase58(),
        zkProofHash: proof.policy_data_hash_hex,
      }),
    ).toString('base64');
    const paidRes = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json', 'x-402-payment': proofHeader },
    });
    if (!paidRes.ok) {
      this.pushActivity(
        'error',
        `x402 retry failed: HTTP ${paidRes.status}`,
        false,
        { txSignature: txSig },
      );
      return;
    }

    // ---- 6. Persist proof record + compressed attestation ---------------
    const paymentId = `agent-x402-${uid()}`;
    await this.submitProofRecord(
      paymentId,
      policy.id,
      proof,
      paymentTokenMint,
      amountLamports,
      txSig,
    );
  }

  /**
   * MPP B-flow cycle. Off-session Stripe charge against a saved customer +
   * payment method, then ZK proof anchored on-chain via verify_mpp_payment_proof.
   * No card UI involvement — the operator did the one-time SCA dance during
   * setup_future_usage at provisioning time.
   *
   * Sequence:
   *   1. GET the protected endpoint, get a 402 + Stripe PaymentIntent challenge.
   *   2. POST paymentIntents.confirm({ off_session: true, payment_method }).
   *   3. Poll the compliance-api until its Stripe webhook fires and persists
   *      the verified_payment_intent row (signature + canonical receipt).
   *   4. POST /prove with stripe_receipt_hash = the row's poseidon_hash_hex.
   *   5. Build the Solana tx: Ed25519 verify ix at index 0 (with the row's
   *      ed25519 signature) + verify_mpp_payment_proof Anchor ix.
   *   6. Replay the protected endpoint with x-mpp-credential and
   *      x-aperture-proof-record headers to unlock the service.
   */
  private async runMppFlow(
    policy: {
      id: string;
      compiled: CompiledPolicy;
      onchainPda: string;
      allowedCategories: readonly string[];
      maxPerTxLamports: number;
    },
    stripeCreds: { customerId: string; paymentMethodId: string },
  ): Promise<void> {
    if (!policy.allowedCategories.includes('mpp')) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity('mpp', 'BLOCKED: category "mpp" not allowed by policy', false);
      return;
    }

    const operatorId = this.activeOperatorId;
    const operator = this.config.wallet.publicKey;
    const endpoint = `${this.config.complianceApiUrl}/api/v1/compliance/mpp-protected-service?operator_id=${operatorId}`;

    // ---- 1. 402 challenge ------------------------------------------------
    const challengeRes = await fetch(endpoint);
    if (challengeRes.status !== 402) {
      this.pushActivity('error', `MPP: expected 402, got ${challengeRes.status}`, false);
      return;
    }
    const challengeBody = (await challengeRes.json()) as {
      readonly mppChallenge?: {
        readonly id: string;
        readonly stripe: { readonly paymentIntentId: string };
        readonly request: { readonly amount: string; readonly currency: string };
      };
    };
    const ch = challengeBody.mppChallenge;
    if (!ch) {
      this.pushActivity('error', 'MPP: challenge missing', false);
      return;
    }
    const amountCents = Math.round(parseFloat(ch.request.amount) * 100);
    if (amountCents <= 0) {
      this.pushActivity('error', `MPP: non-positive challenge amount ${ch.request.amount}`, false);
      return;
    }
    // The MPP cycle bills in fiat cents but the policy ceiling is in aUSDC
    // lamports (6 decimals). Use 1 cent = 10_000 lamports as the canonical
    // exchange rate so the ceiling check applies equally to both rails. A
    // production deployment with a real FX feed would source this rate
    // dynamically; we surface the constant here so swapping it is one edit.
    const CENTS_TO_LAMPORTS = 10_000;
    const amountLamports = amountCents * CENTS_TO_LAMPORTS;
    if (amountLamports > policy.maxPerTxLamports) {
      this.mutStats(() => ({ totalViolations: this.stats.totalViolations + 1 }));
      this.pushActivity('mpp', 'BLOCKED: amount exceeds max_per_tx', false);
      return;
    }

    // ---- 2. Off-session Stripe confirm ----------------------------------
    const confirmRes = await fetch(
      `https://api.stripe.com/v1/payment_intents/${ch.stripe.paymentIntentId}/confirm`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.stripeSecretKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          payment_method: stripeCreds.paymentMethodId,
          off_session: 'true',
        }).toString(),
      },
    );
    const pi = (await confirmRes.json()) as {
      id?: string;
      status?: string;
      last_payment_error?: { message?: string };
      error?: { message?: string; code?: string; type?: string };
    };
    if (pi.status !== 'succeeded') {
      const reason =
        pi.last_payment_error?.message ??
        pi.error?.message ??
        `status=${pi.status} (HTTP ${confirmRes.status})`;
      this.pushActivity('error', `Stripe off_session confirm failed: ${reason}`, false, {
        paymentIntentId: pi.id ?? undefined,
      });
      log(`Stripe confirm raw response: ${JSON.stringify(pi).slice(0, 500)}`);
      return;
    }
    log(`Stripe PaymentIntent confirmed: ${pi.id}`);

    // ---- 3. Poll compliance-api for the webhook-persisted attestation ---
    // 60s timeout — Stripe sandbox occasionally delays webhook delivery for
    // off_session direct charges by 5–15 seconds, and the original 30s
    // window meant agent cycles failed intermittently on the first attempt.
    const verifiedReceipt = await this.pollVerifiedReceipt(pi.id!, 60_000);
    if (!verifiedReceipt) {
      this.pushActivity(
        'error',
        `Compliance-api never received the Stripe webhook for ${pi.id}. Is stripe listen / production webhook reachable?`,
        false,
        { paymentIntentId: pi.id! },
      );
      return;
    }

    // ---- 4. ZK proof with stripe_receipt_hash = poseidon hash -----------
    const dailySpentBefore = await readEffectiveDailySpentLamports(this.connection, operator);
    const nowUnix = Math.floor(Date.now() / 1000);
    const stripeReceiptDecimal = BigInt('0x' + verifiedReceipt.poseidon_hash_hex).toString();

    // The MPP flow has no Solana destination; we commit the operator's own
    // pubkey as recipient + a stable-coin sentinel for the mint. Both fields
    // land in the proof's public outputs but the verifier path does not
    // cross-check them against any Solana transfer. The sentinel must be on
    // the active policy's token whitelist or the ZK circuit returns
    // is_compliant=false. We pick the first whitelisted stablecoin (typically
    // USDC) so the MPP cycle works regardless of which tokens the operator
    // has enabled — fall back to aUSDC for legacy policies.
    const whitelist = policy.compiled.token_whitelist;
    const sentinelMint =
      whitelist.find((m: string) => m === '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') ??
      whitelist[0] ??
      this.config.ausdcMint;
    const proof = await this.generateProof(
      policy.compiled,
      operator.toBase58(),
      sentinelMint,
      amountLamports,
      'mpp',
      dailySpentBefore,
      nowUnix,
      stripeReceiptDecimal,
    );
    if (!proof) return;

    // ---- 5. Solana tx: Ed25519 verify (index 0) + verify_mpp_payment_proof
    const policyIdBytes = sha256(policy.id);
    const [operatorAccount] = deriveOperatorPDA(operator);
    const [policyAccount] = derivePolicyPDA(operatorAccount, policyIdBytes);

    const proofA = Uint8Array.from(Buffer.from(proof.groth16.proof_a, 'base64'));
    const proofB = Uint8Array.from(Buffer.from(proof.groth16.proof_b, 'base64'));
    const proofC = Uint8Array.from(Buffer.from(proof.groth16.proof_c, 'base64'));
    const publicInputs = proof.groth16.public_inputs.map((b64) =>
      Uint8Array.from(Buffer.from(b64, 'base64')),
    );

    // The 32-byte message the ed25519 ix authenticates is the raw bytes of
    // poseidon_hash_hex, NOT the field-element decimal — the on-chain
    // verifier reads public_inputs[9] as 32 BE bytes and the ed25519
    // message must match byte-for-byte.
    const stripeReceiptHashBytes = Buffer.from(verifiedReceipt.poseidon_hash_hex, 'hex');
    const authoritySignature = bs58.decode(verifiedReceipt.authority_signature_b58);
    if (authoritySignature.length !== 64) {
      this.pushActivity('error', 'MPP authority signature is not 64 bytes — webhook persisted bad data', false);
      return;
    }
    const authorityPubkey = new PublicKey(verifiedReceipt.authority_pubkey_b58);
    const ed25519Ix = buildEd25519VerifyIx(
      authorityPubkey,
      authoritySignature,
      stripeReceiptHashBytes,
    );

    const verifyMppIx = buildVerifyMppPaymentProofIx({
      operator,
      payer: operator,
      policyAccount,
      operatorAccount,
      proofA,
      proofB,
      proofC,
      publicInputs,
    });

    const tx = new Transaction().add(ed25519Ix).add(verifyMppIx);
    tx.feePayer = operator;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(this.config.wallet);

    let txSig: string;
    try {
      txSig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(txSig, 'confirmed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'transaction failed';
      this.pushActivity('error', `MPP verify_mpp tx failed: ${msg}`, false, {
        paymentIntentId: pi.id!,
      });
      return;
    }

    log(`MPP on-chain verified: ${txSig}`);
    this.mutStats(() => ({
      totalMpp: this.stats.totalMpp + 1,
      totalMppSpent: this.stats.totalMppSpent + amountCents / 100,
    }));
    this.pushActivity('mpp', `$${(amountCents / 100).toFixed(2)} via Stripe + on-chain verified`, true, {
      proofHash: proof.policy_data_hash_hex,
      txSignature: txSig,
      paymentIntentId: pi.id!,
    });

    // ---- 6. Replay endpoint with both credentials -----------------------
    const credential = Buffer.from(
      JSON.stringify({ challengeId: ch.id, paymentIntentId: pi.id! }),
    ).toString('base64');
    const [proofRecordPDA] = deriveProofRecordPDA(operator, Buffer.from(publicInputs[1]));

    const paidRes = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'x-mpp-credential': credential,
        'x-aperture-proof-record': proofRecordPDA.toBase58(),
      },
    });
    if (!paidRes.ok) {
      this.pushActivity(
        'error',
        `MPP retry failed: HTTP ${paidRes.status}`,
        false,
        { paymentIntentId: pi.id!, txSignature: txSig },
      );
      return;
    }

    const paymentId = `agent-mpp-${uid()}`;
    await this.submitProofRecord(
      paymentId,
      policy.id,
      proof,
      'usd',
      amountLamports,
      txSig,
    );
  }

  private async pollVerifiedReceipt(
    paymentIntentId: string,
    timeoutMs: number,
  ): Promise<{ poseidon_hash_hex: string; authority_signature_b58: string; authority_pubkey_b58: string } | null> {
    const start = Date.now();
    const url = `${this.config.complianceApiUrl}/api/v1/compliance/verified-payment/${paymentIntentId}`;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const body = (await res.json()) as {
            readonly data?: {
              readonly poseidon_hash_hex: string;
              readonly authority_signature_b58: string;
              readonly authority_pubkey_b58: string;
            };
          };
          if (body.data?.poseidon_hash_hex) return body.data;
        }
      } catch {
        // ignore transient errors and retry
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
  }

  private async submitProofRecord(
    paymentId: string,
    policyId: string,
    proof: ProverResponse,
    tokenMint: string,
    amountLamports: number,
    txSignature: string | null,
  ): Promise<void> {
    const createRes = await fetch(`${this.config.complianceApiUrl}/api/v1/proofs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator_id: this.activeOperatorId,
        policy_id: policyId,
        payment_id: paymentId,
        proof_hash: proof.policy_data_hash_hex,
        // Exact amount now lives on-chain in ProofRecord; mirror it here for
        // dashboard display. min == max because the value is no longer bucketed.
        amount_range_min: amountLamports / 1_000_000,
        amount_range_max: amountLamports / 1_000_000,
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
    }
    if (proof.is_compliant) {
      try {
        await fetch(
          `${this.config.complianceApiUrl}/api/v1/compliance/compress-attestation`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              proof_id: created.data.id,
              recipient: this.activeOperatorId,
            }),
          },
        );
      } catch {
        // Light Protocol unavailability is non-blocking.
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
          operator_id: this.activeOperatorId,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
        }),
      });
      if (!res.ok) return;

      const attData = (await res.json()) as { data: { id: string; proof_hash: string; total_payments: number } };
      const att = attData.data;

      const batchHashBytes = hexToBytes32(att.proof_hash);
      const periodStartUnix = BigInt(Math.floor(periodStart.getTime() / 1000));
      const periodEndUnix = BigInt(Math.floor(periodEnd.getTime() / 1000));
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

      await fetch(
        `${this.config.complianceApiUrl}/api/v1/attestations/${att.id}/tx-signature`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_signature: txSig }),
        },
      );

      this.pushActivity('attestation', `Batch attestation anchored on Solana`, true, {
        proofHash: att.proof_hash,
        txSignature: txSig,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.pushActivity('error', `Attestation failed: ${msg}`, false);
    }
  }
}
