export interface PaymentRequest {
  readonly payment_id: string;
  readonly operator_id: string;
  readonly policy_id: string;
  readonly sender_address: string;
  readonly recipient_address: string;
  readonly amount: number;
  readonly token_mint: string;
  readonly endpoint_category: string;
  readonly memo: string;
  readonly timestamp: Date;
}

export interface PaymentResult {
  readonly payment_id: string;
  readonly success: boolean;
  readonly transaction_signature: string | null;
  readonly proof_hash: string | null;
  readonly error: string | null;
}

export interface ProofRequest {
  readonly payment: PaymentRequest;
  readonly policy_json: string;
}

export interface ProofResult {
  readonly proof_hash: string;
  readonly is_compliant: boolean;
  readonly verification_timestamp: Date;
  readonly amount_range: {
    readonly min: number;
    readonly max: number;
  };
  readonly proof_bytes: Uint8Array;
}

export interface ProverInput {
  readonly policy_id: string;
  readonly operator_id: string;
  readonly max_daily_spend_lamports: string;
  readonly max_per_transaction_lamports: string;
  readonly allowed_endpoint_categories: readonly string[];
  readonly blocked_addresses: readonly string[];
  readonly time_restrictions: readonly {
    readonly allowed_days: readonly string[];
    readonly allowed_hours_start: number;
    readonly allowed_hours_end: number;
    readonly timezone: string;
  }[];
  readonly token_whitelist: readonly string[];
  readonly payment_amount_lamports: string;
  readonly payment_token_mint: string;
  readonly payment_recipient: string;
  readonly payment_endpoint_category: string;
  readonly payment_timestamp: string;
  readonly daily_spent_so_far_lamports: string;
}

export interface ProverOutput {
  readonly is_compliant: boolean;
  readonly proof_hash: string;
  readonly amount_range_min: string;
  readonly amount_range_max: string;
  readonly verification_timestamp: string;
  readonly journal_digest: string;
}
