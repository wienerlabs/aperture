/**
 * Compiled policy as returned by the policy-service `/compile` endpoint. All
 * monetary fields are in lamports (6-decimal USDC representation) so they map
 * 1:1 onto the on-chain ceiling check.
 */
export interface CompiledPolicy {
  readonly policy_id: string;
  readonly operator_id: string;
  readonly max_daily_spend_lamports: string;
  readonly max_per_transaction_lamports: string;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly token_whitelist: readonly string[];
  readonly time_restrictions: readonly TimeRestriction[];
}

export interface TimeRestriction {
  readonly allowed_days: readonly string[];
  readonly allowed_hours_start: number;
  readonly allowed_hours_end: number;
  readonly timezone: string;
}

/**
 * Policy record summary as returned by `/api/v1/policies/operator/{id}`.
 * Anchor sets `onchain_status` to `'registered'` once the policy's Merkle
 * root has been written to Solana; the SDK refuses to proceed otherwise
 * because the verifier rejects unknown policy PDAs.
 */
export interface PolicySummary {
  readonly id: string;
  readonly max_per_transaction: number;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly token_whitelist: readonly string[];
  readonly onchain_pda: string | null;
  readonly onchain_status: string;
}

export interface LoadedPolicy {
  readonly id: string;
  readonly compiled: CompiledPolicy;
  readonly onchainPda: string;
  readonly maxPerTxLamports: number;
  readonly allowedCategories: readonly string[];
  readonly blockedAddresses: readonly string[];
  readonly tokenWhitelist: readonly string[];
}

/**
 * Request body the prover-service expects on POST /prove. Mirrors the
 * validator in `services/prover-service/src/prover.js`.
 */
export interface ProveRequest {
  readonly policy_id: string;
  readonly operator_id: string;
  readonly max_daily_spend_lamports: number;
  readonly max_per_transaction_lamports: number;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly token_whitelist: readonly string[];
  readonly time_restrictions?: readonly TimeRestriction[];
  readonly payment_amount_lamports: number;
  readonly payment_token_mint: string;
  readonly payment_recipient: string;
  readonly payment_endpoint_category: string;
  readonly daily_spent_before_lamports: string;
  readonly current_unix_timestamp: number;
  /** Decimal-string Poseidon hash. '0' for x402 (no Stripe receipt). */
  readonly stripe_receipt_hash?: string;
}

/**
 * Response shape the prover-service returns. The `groth16` block is what the
 * on-chain verifier consumes; everything else is metadata.
 */
export interface ProveResponse {
  readonly is_compliant: boolean;
  readonly policy_data_hash: string;
  readonly policy_data_hash_hex: string;
  readonly proof_hash: string;
  readonly verification_timestamp: string;
  readonly proving_time_ms?: number;
  readonly groth16: {
    /** Base64-encoded 64-byte G1 point. */
    readonly proof_a: string;
    /** Base64-encoded 128-byte G2 point. */
    readonly proof_b: string;
    /** Base64-encoded 64-byte G1 point. */
    readonly proof_c: string;
    /** Ten base64-encoded 32-byte field elements. */
    readonly public_inputs: readonly string[];
  };
  readonly public_signals?: {
    readonly amount_lamports?: string;
    readonly daily_spent_before?: string;
    readonly current_unix_timestamp?: string;
  };
}

/**
 * 402 challenge body returned by an x402 endpoint.
 */
export interface X402Challenge {
  readonly paymentRequirement: {
    readonly token: string;
    readonly amount: string;
    readonly recipient: string;
  };
}

/**
 * 402 challenge body returned by an MPP endpoint.
 */
export interface MPPChallenge {
  readonly mppChallenge: {
    readonly id: string;
    readonly stripe: { readonly paymentIntentId: string };
    readonly request: { readonly amount: string; readonly currency: string };
  };
}

/**
 * Verified Stripe receipt as persisted by compliance-api after the webhook
 * (or sync) verifies the Stripe signature.
 */
export interface VerifiedStripeReceipt {
  readonly poseidon_hash_hex: string;
  readonly authority_signature_b58: string;
  readonly authority_pubkey_b58: string;
}

export interface StripeCredentials {
  readonly customerId: string;
  readonly paymentMethodId: string;
}

/**
 * Pluggable confirmer for the Stripe PaymentIntent step. The default
 * implementation in the SDK performs an off_session direct confirm against
 * the Stripe REST API using a server-side secret key. Consumers can swap in
 * SCA/hosted-checkout flows by supplying their own confirmer.
 */
export interface StripeConfirmer {
  (input: {
    readonly paymentIntentId: string;
    readonly credentials: StripeCredentials;
  }): Promise<{ readonly id: string; readonly status: string }>;
}

export interface PaymentRecording {
  /** Compliance-api proof row UUID. */
  readonly proofRowId: string;
  /** Light Protocol compressed attestation tx, when available. */
  readonly compressedAttestationTx: string | null;
}

export interface X402PaymentResult {
  readonly txSignature: string;
  readonly proofRecordPda: string;
  readonly amountLamports: number;
  readonly tokenMint: string;
  readonly recipient: string;
  readonly response: Response;
  /** Set when a ComplianceClient is wired into the client. */
  readonly recording: PaymentRecording | null;
}

/**
 * Input shape for `POST /api/v1/policies`. Matches the policy-service's
 * `PolicySchema` from @aperture/types. Amounts here are in human USDC
 * (not lamports); the compile endpoint converts them to integer lamports
 * before the ZK circuit consumes them.
 */
export interface PolicyInput {
  readonly operator_id: string;
  readonly name: string;
  readonly description?: string;
  readonly max_daily_spend: number;
  readonly max_per_transaction: number;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses?: readonly string[];
  readonly time_restrictions?: readonly TimeRestriction[];
  readonly token_whitelist?: readonly string[];
  readonly is_active?: boolean;
}

/** Update payload — any subset of policy rules, excluding `operator_id`. */
export type PolicyUpdate = Partial<Omit<PolicyInput, 'operator_id'>>;

/**
 * Full Policy as persisted by policy-service. Includes server-assigned ID,
 * Merkle commitments, on-chain anchor state, and version counters.
 */
export interface Policy extends PolicyInput {
  readonly id: string;
  readonly version: number;
  readonly merkle_root_hex: string;
  readonly policy_data_hash_hex: string;
  readonly onchain_pda: string | null;
  readonly onchain_status: 'pending' | 'registered' | 'failed' | string;
  readonly onchain_tx_signature: string | null;
  readonly onchain_version: number | null;
  readonly onchain_registered_at: string | null;
  readonly onchain_last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Payload `policy-service` issues for the on-chain anchor flow. The dashboard
 * and SDK read this verbatim — Merkle root + policy_data_hash are computed
 * server-side from a canonical schema so the values can never drift between
 * the policy DB and the ZK circuit.
 */
export interface OnchainPayload {
  readonly policy_id: string;
  readonly policy_id_bytes_hex: string;
  readonly merkle_root_hex: string;
  readonly policy_data_hash_hex: string;
  readonly version: number;
  readonly operator_id: string;
  readonly onchain_status: string;
  readonly onchain_pda: string | null;
  readonly onchain_version: number | null;
  /** 'register' (first anchor), 'update' (bump version), or 'noop'. */
  readonly operation: 'register' | 'update' | 'noop';
}

export type OnchainConfirmation =
  | {
      readonly status: 'registered';
      readonly tx_signature: string;
      readonly onchain_pda: string;
      readonly onchain_version: number;
      readonly merkle_root_hex: string;
      readonly policy_data_hash_hex: string;
    }
  | {
      readonly status: 'failed';
      readonly error_message: string;
    };

/** Server-side ProofRecord row returned by `POST /api/v1/proofs`. */
export interface ProofRecordRow {
  readonly id: string;
  readonly operator_id: string;
  readonly policy_id: string;
  readonly payment_id: string;
  readonly proof_hash: string;
  readonly is_compliant: boolean;
  readonly token_mint: string;
  readonly verified_at: string;
  readonly tx_signature: string | null;
  readonly compressed_tx_signature: string | null;
}

export interface BatchAttestationSummary {
  readonly id: string;
  readonly operator_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly total_payments: number;
  readonly proof_hash: string;
}

export interface MppPaymentResult {
  readonly txSignature: string;
  readonly proofRecordPda: string;
  readonly paymentIntentId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly response: Response;
  /** Set when a ComplianceClient is wired into the client. */
  readonly recording: PaymentRecording | null;
}
