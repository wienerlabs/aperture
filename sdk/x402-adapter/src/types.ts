import type { PaymentRequest, ProofResult } from '@aperture/types';

export interface X402Config {
  readonly facilitator_url: string;
  readonly network: 'solana-devnet' | 'solana-mainnet';
  readonly prover_service_url: string;
  readonly policy_service_url: string;
  readonly supported_tokens: readonly {
    readonly symbol: string;
    readonly mint_address: string;
    readonly decimals: number;
  }[];
}

export interface X402PaymentHeader {
  readonly version: '1';
  readonly scheme: 'exact';
  readonly network: string;
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
  readonly extra: {
    readonly aperture_proof_hash: string;
    readonly aperture_policy_id: string;
    readonly aperture_operator_id: string;
  };
}

export interface X402ProofHeader {
  readonly proof_hash: string;
  readonly is_compliant: boolean;
  readonly amount_range: {
    readonly min: number;
    readonly max: number;
  };
  readonly verification_timestamp: string;
}

export interface X402InterceptResult {
  readonly payment: PaymentRequest;
  readonly proof: ProofResult | null;
  readonly header: X402PaymentHeader;
  readonly approved: boolean;
  readonly rejection_reason: string | null;
}
