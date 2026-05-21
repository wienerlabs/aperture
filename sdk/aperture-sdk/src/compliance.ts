import { ApertureError } from './errors.js';
import type {
  BatchAttestationSummary,
  ProofRecordRow,
  ProveResponse,
} from './types.js';

export interface ComplianceClientOptions {
  /** Base URL of the compliance-api. No trailing slash. */
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

export interface SubmitProofInput {
  readonly operatorId: string;
  readonly policyId: string;
  readonly paymentId: string;
  readonly tokenMint: string;
  readonly amountLamports: number;
  readonly proof: ProveResponse;
  readonly txSignature?: string | null;
}

export interface CreateBatchInput {
  readonly operatorId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
}

/**
 * HTTP client for the Aperture compliance-api. Records proofs after a
 * successful on-chain verify so the dashboard / audit pages have the full
 * trail, optionally mints a Light Protocol compressed attestation, and
 * builds periodic batch attestations the verifier program anchors as a
 * single `verify_batch_attestation` instruction.
 */
export class ComplianceClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ComplianceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Persists a proof record on the compliance-api. The dashboard uses these
   * rows for the audit feed and the batch attestation aggregator. Returns
   * the server-assigned row including its UUID, which the caller passes to
   * `mintCompressedAttestation` and the audit URL helpers.
   *
   * The exact-on-chain amount lives in the ProofRecord PDA; the row here
   * mirrors it for display. `amount_range_min == amount_range_max` because
   * the v2 verifier no longer buckets amounts.
   */
  async submitProof(input: SubmitProofInput): Promise<ProofRecordRow> {
    const usdc = input.amountLamports / 1_000_000;
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/proofs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator_id: input.operatorId,
        policy_id: input.policyId,
        payment_id: input.paymentId,
        proof_hash: input.proof.policy_data_hash_hex,
        amount_range_min: usdc,
        amount_range_max: usdc,
        token_mint: input.tokenMint,
        is_compliant: input.proof.is_compliant,
        verified_at: input.proof.verification_timestamp,
      }),
    });
    if (!res.ok) {
      throw new ApertureError(
        `compliance-api POST /proofs returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { readonly data: ProofRecordRow };
    const row = body.data;
    if (input.txSignature) {
      await this.attachTxSignature(row.id, input.txSignature).catch(() => undefined);
    }
    return row;
  }

  async attachTxSignature(
    proofId: string,
    txSignature: string,
  ): Promise<void> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/proofs/${proofId}/tx-signature`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_signature: txSignature }),
      },
    );
    if (!res.ok) {
      throw new ApertureError(
        `compliance-api PATCH /proofs/${proofId}/tx-signature returned HTTP ${res.status}`,
      );
    }
  }

  /**
   * Mints a Light Protocol compressed attestation token to `recipient` that
   * carries the proof's identifier. Returns the tx signature. Idempotent on
   * the compliance-api side. Returns null when the compliance-api signals
   * that compressed attestations are unavailable (missing Light Protocol
   * config) — this is a non-blocking, best-effort step.
   */
  async mintCompressedAttestation(
    proofId: string,
    recipient: string,
  ): Promise<string | null> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/compliance/compress-attestation`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof_id: proofId, recipient }),
      },
    );
    if (!res.ok) {
      // 503 = Light Protocol config missing → treat as optional.
      if (res.status === 503) return null;
      throw new ApertureError(
        `compliance-api POST /compress-attestation returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      readonly data: { readonly tx_signature: string };
    };
    return body.data.tx_signature;
  }

  /**
   * Builds a batch attestation that aggregates every proof in the given
   * period. The compliance-api computes a deterministic Merkle hash over the
   * sorted proof_hashes and returns it as `proof_hash`; the caller then
   * anchors that hash on-chain with `verify_batch_attestation`.
   */
  async createBatch(input: CreateBatchInput): Promise<BatchAttestationSummary> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/attestations/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operator_id: input.operatorId,
        period_start: input.periodStart.toISOString(),
        period_end: input.periodEnd.toISOString(),
      }),
    });
    if (!res.ok) {
      throw new ApertureError(
        `compliance-api POST /attestations/batch returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { readonly data: BatchAttestationSummary };
    return body.data;
  }

  async attachAttestationTxSignature(
    attestationId: string,
    txSignature: string,
  ): Promise<void> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/attestations/${attestationId}/tx-signature`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_signature: txSignature }),
      },
    );
    if (!res.ok) {
      throw new ApertureError(
        `compliance-api PATCH /attestations/${attestationId}/tx-signature returned HTTP ${res.status}`,
      );
    }
  }
}
