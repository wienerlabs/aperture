import type { PaymentRequest } from '@aperture/types';
import { X402Adapter } from './adapter.js';
import type { X402Config, X402InterceptResult } from './types.js';

export class X402PaymentInterceptor {
  private readonly adapter: X402Adapter;
  private readonly network: X402Config['network'];

  constructor(config: X402Config, rpcUrl: string) {
    this.adapter = new X402Adapter(config, rpcUrl);
    this.network = config.network;
  }

  async intercept(payment: PaymentRequest): Promise<X402InterceptResult> {
    const validation = await this.adapter.validatePaymentRequest(payment);
    if (!validation.valid) {
      return {
        payment,
        proof: null,
        header: this.buildEmptyHeader(payment),
        approved: false,
        rejection_reason: validation.error,
      };
    }

    const balance = await this.adapter.checkTokenBalance(
      payment.sender_address,
      payment.token_mint
    );
    if (balance < payment.amount) {
      return {
        payment,
        proof: null,
        header: this.buildEmptyHeader(payment),
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
        header: this.buildEmptyHeader(payment),
        approved: false,
        rejection_reason: 'Payment does not comply with operator policy',
      };
    }

    const header = this.adapter.buildPaymentHeader(payment, proof);

    return {
      payment,
      proof,
      header,
      approved: true,
      rejection_reason: null,
    };
  }

  private buildEmptyHeader(payment: PaymentRequest): X402InterceptResult['header'] {
    return {
      version: '1',
      scheme: 'exact',
      network: this.network,
      token: payment.token_mint,
      amount: payment.amount.toString(),
      recipient: payment.recipient_address,
      extra: {
        aperture_proof_hash: '',
        aperture_policy_id: payment.policy_id,
        aperture_operator_id: payment.operator_id,
      },
    };
  }
}
