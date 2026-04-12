import type { PaymentRequest, ProofResult } from '@aperture/types';

export interface MPPConfig {
  readonly api_url: string;
  readonly network: 'solana-devnet' | 'solana-mainnet';
  readonly prover_service_url: string;
  readonly policy_service_url: string;
  readonly supported_tokens: readonly {
    readonly symbol: string;
    readonly mint_address: string;
    readonly decimals: number;
  }[];
}

export interface MPPPaymentInstruction {
  readonly version: '1.0';
  readonly protocol: 'mpp';
  readonly network: string;
  readonly token_mint: string;
  readonly amount_lamports: string;
  readonly sender: string;
  readonly recipient: string;
  readonly memo: string;
  readonly proof_attachment: MPPProofAttachment | null;
}

export interface MPPProofAttachment {
  readonly aperture_proof_hash: string;
  readonly aperture_policy_id: string;
  readonly aperture_operator_id: string;
  readonly is_compliant: boolean;
  readonly amount_range: {
    readonly min: number;
    readonly max: number;
  };
  readonly verification_timestamp: string;
}

export interface MPPInterceptResult {
  readonly payment: PaymentRequest;
  readonly proof: ProofResult | null;
  readonly instruction: MPPPaymentInstruction;
  readonly approved: boolean;
  readonly rejection_reason: string | null;
}

export interface MPPChallenge {
  readonly id: string;
  readonly realm: string;
  readonly method: string;
  readonly intent: string;
  readonly expires: string;
  readonly request: {
    readonly amount: string;
    readonly currency: string;
    readonly description: string;
    readonly resource: string;
  };
  readonly stripe: {
    readonly paymentIntentId: string;
    readonly clientSecret: string;
  };
}

export interface MPPCredential {
  readonly challengeId: string;
  readonly paymentIntentId: string;
}

export interface MPPReceipt {
  readonly method: string;
  readonly status: 'success';
  readonly timestamp: string;
  readonly reference: string;
  readonly amount: string;
  readonly currency: string;
}

export interface MPPResult<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly payment: {
    readonly protocol: 'mpp';
    readonly paymentIntentId: string;
    readonly amount: string;
    readonly currency: string;
    readonly zkProofHash: string | null;
  } | null;
  readonly error: string | null;
}
