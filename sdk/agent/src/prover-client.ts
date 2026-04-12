interface CompiledPolicy {
  readonly policy_id: string;
  readonly operator_id: string;
  readonly max_daily_spend_lamports: string;
  readonly max_per_transaction_lamports: string;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly token_whitelist: readonly string[];
}

export interface ProofOutput {
  readonly proof_hash: string;
  readonly is_compliant: boolean;
  readonly amount_range_min: number;
  readonly amount_range_max: number;
  readonly verification_timestamp: string;
  readonly proving_time_ms: number;
  readonly receipt_bytes: number[];
  readonly image_id: string;
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Aperture Agent] ${msg}`);
}

export class ProverClient {
  private readonly proverUrl: string;

  constructor(proverUrl: string) {
    this.proverUrl = proverUrl;
  }

  async generateProof(
    compiled: CompiledPolicy,
    paymentAmountLamports: number,
    paymentTokenMint: string,
    paymentRecipient: string,
    endpointCategory: string,
    dailySpentLamports: number,
  ): Promise<ProofOutput> {
    log(
      'Generating ZK proof via RISC Zero prover... this may take several minutes',
    );
    const startMs = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600_000);

    const res = await fetch(`${this.proverUrl}/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        policy_id: compiled.policy_id,
        operator_id: compiled.operator_id,
        max_daily_spend_lamports: parseInt(
          compiled.max_daily_spend_lamports,
          10,
        ),
        max_per_transaction_lamports: parseInt(
          compiled.max_per_transaction_lamports,
          10,
        ),
        allowed_endpoint_categories: compiled.allowed_endpoint_categories,
        blocked_addresses: compiled.blocked_addresses,
        token_whitelist: compiled.token_whitelist,
        payment_amount_lamports: paymentAmountLamports,
        payment_token_mint: paymentTokenMint,
        payment_recipient: paymentRecipient,
        payment_endpoint_category: endpointCategory,
        payment_timestamp: new Date().toISOString(),
        daily_spent_so_far_lamports: dailySpentLamports,
      }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Prover service error (${res.status}): ${errBody}`);
    }

    const proof = (await res.json()) as ProofOutput;
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const receiptSize = proof.receipt_bytes?.length ?? 0;

    log(
      `ZK proof generated in ${elapsed}s (${receiptSize > 1000 ? `${(receiptSize / 1024).toFixed(0)}KB` : `${receiptSize}B`} receipt)`,
    );
    log(`  Proof hash: ${proof.proof_hash}`);
    log(`  Compliant: ${proof.is_compliant}`);

    return proof;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.proverUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
