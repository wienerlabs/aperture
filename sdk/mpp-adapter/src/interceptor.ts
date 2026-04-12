import type { PaymentRequest } from '@aperture/types';
import { MPPAdapter } from './adapter.js';
import type { MPPConfig, MPPInterceptResult } from './types.js';

export class MPPPaymentInterceptor {
  private readonly adapter: MPPAdapter;

  constructor(config: MPPConfig, rpcUrl: string) {
    this.adapter = new MPPAdapter(config, rpcUrl);
  }

  async intercept(payment: PaymentRequest): Promise<MPPInterceptResult> {
    const validation = await this.adapter.validatePaymentRequest(payment);
    if (!validation.valid) {
      return {
        payment,
        proof: null,
        instruction: this.adapter.buildPaymentInstruction(payment, null),
        approved: false,
        rejection_reason: validation.error,
      };
    }

    const balance = await this.adapter.checkTokenBalance(
      payment.sender_address,
      payment.token_mint,
    );
    if (balance < payment.amount) {
      return {
        payment,
        proof: null,
        instruction: this.adapter.buildPaymentInstruction(payment, null),
        approved: false,
        rejection_reason: `Insufficient balance: ${balance} < ${payment.amount}`,
      };
    }

    const policyJson = await this.adapter.fetchPolicyJson(payment.policy_id);
    const proofRequest = this.adapter.buildProofRequest(payment, policyJson);
    const proof = await this.adapter.requestProof(proofRequest);

    if (!proof.is_compliant) {
      return {
        payment,
        proof,
        instruction: this.adapter.buildPaymentInstruction(payment, proof),
        approved: false,
        rejection_reason: 'Payment does not comply with operator policy',
      };
    }

    const instruction = this.adapter.buildPaymentInstruction(payment, proof);

    return {
      payment,
      proof,
      instruction,
      approved: true,
      rejection_reason: null,
    };
  }
}
