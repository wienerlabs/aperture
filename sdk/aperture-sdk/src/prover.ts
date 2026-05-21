import { ProverError } from './errors.js';
import type {
  CompiledPolicy,
  ProveRequest,
  ProveResponse,
} from './types.js';

export interface ProverClientOptions {
  /** Base URL of the prover-service. No trailing slash. */
  readonly baseUrl: string;
  /** Health-check timeout, default 5s. */
  readonly healthTimeoutMs?: number;
  /** Prove timeout. Default 10 min — Circom Groth16 proving is slow. */
  readonly proveTimeoutMs?: number;
  /** Fetch override for tests. */
  readonly fetch?: typeof fetch;
}

export interface GenerateProofInput {
  readonly compiledPolicy: CompiledPolicy;
  readonly paymentRecipient: string;
  readonly paymentTokenMint: string;
  readonly paymentAmountLamports: number;
  readonly paymentEndpointCategory: string;
  /**
   * Daily-spent counter the on-chain OperatorState will report at submit
   * time. Use `readEffectiveDailySpentLamports` so the proof's public input
   * matches what the verifier recomputes after UTC rollover.
   */
  readonly dailySpentBeforeLamports: bigint;
  /**
   * Unix seconds the circuit will bind to `current_unix_timestamp`. The
   * verifier compares this to the Solana clock at submit time and rejects
   * proofs that are stale, so pin a value close to send-time.
   */
  readonly currentUnixSeconds: number;
  /**
   * Decimal-string Poseidon hash of a verified Stripe receipt. Pass '0' for
   * x402 flows (no Stripe receipt).
   */
  readonly stripeReceiptHash?: string;
}

/**
 * HTTP client for the Aperture prover-service. The service wraps the
 * Circom payment circuit with snarkjs Groth16 and returns a proof bundle the
 * on-chain verifier can consume via Solana's alt_bn128 syscalls.
 */
export class ProverClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly healthTimeoutMs: number;
  private readonly proveTimeoutMs: number;

  constructor(options: ProverClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
    this.proveTimeoutMs = options.proveTimeoutMs ?? 600_000;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(this.healthTimeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateProof(input: GenerateProofInput): Promise<ProveResponse> {
    const body: ProveRequest = {
      policy_id: input.compiledPolicy.policy_id,
      operator_id: input.compiledPolicy.operator_id,
      max_daily_spend_lamports: parseInt(
        input.compiledPolicy.max_daily_spend_lamports,
        10,
      ),
      max_per_transaction_lamports: parseInt(
        input.compiledPolicy.max_per_transaction_lamports,
        10,
      ),
      allowed_endpoint_categories:
        input.compiledPolicy.allowed_endpoint_categories,
      blocked_addresses: input.compiledPolicy.blocked_addresses,
      token_whitelist: input.compiledPolicy.token_whitelist,
      time_restrictions: input.compiledPolicy.time_restrictions,
      payment_amount_lamports: input.paymentAmountLamports,
      payment_token_mint: input.paymentTokenMint,
      payment_recipient: input.paymentRecipient,
      payment_endpoint_category: input.paymentEndpointCategory,
      daily_spent_before_lamports: input.dailySpentBeforeLamports.toString(),
      current_unix_timestamp: input.currentUnixSeconds,
      stripe_receipt_hash: input.stripeReceiptHash ?? '0',
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.proveTimeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new ProverError(
        `prover-service request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      throw new ProverError(
        `prover-service /prove returned HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    const proof = (await res.json()) as ProveResponse;
    if (!proof.is_compliant) {
      throw new ProverError(
        'Proof returned is_compliant=false — payment violates the active policy',
      );
    }
    return proof;
  }
}
