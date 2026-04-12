import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import type { PaymentRequest, ProofResult, ProofRequest } from '@aperture/types';
import type { X402Config, X402PaymentHeader, X402ProofHeader } from './types.js';

export class X402Adapter {
  private readonly connection: Connection;
  private readonly config: X402Config;

  constructor(config: X402Config, rpcUrl: string) {
    this.config = config;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async validatePaymentRequest(payment: PaymentRequest): Promise<{ valid: boolean; error: string | null }> {
    const token = this.config.supported_tokens.find(
      (t) => t.mint_address === payment.token_mint
    );

    if (!token) {
      return { valid: false, error: `Unsupported token mint: ${payment.token_mint}` };
    }

    if (payment.amount <= 0) {
      return { valid: false, error: 'Payment amount must be positive' };
    }

    try {
      new PublicKey(payment.sender_address);
      new PublicKey(payment.recipient_address);
    } catch {
      return { valid: false, error: 'Invalid Solana address format' };
    }

    return { valid: true, error: null };
  }

  async checkTokenBalance(walletAddress: string, tokenMint: string): Promise<number> {
    const wallet = new PublicKey(walletAddress);
    const mint = new PublicKey(tokenMint);
    const ata = await getAssociatedTokenAddress(mint, wallet);

    try {
      const account = await getAccount(this.connection, ata);
      const token = this.config.supported_tokens.find((t) => t.mint_address === tokenMint);
      const decimals = token?.decimals ?? 6;
      return Number(account.amount) / Math.pow(10, decimals);
    } catch {
      return 0;
    }
  }

  buildProofRequest(payment: PaymentRequest, policyJson: string): ProofRequest {
    return {
      payment: { ...payment },
      policy_json: policyJson,
    };
  }

  async requestProof(proofRequest: ProofRequest): Promise<ProofResult> {
    const response = await fetch(`${this.config.prover_service_url}/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proofRequest),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Prover service error (${response.status}): ${errorBody}`);
    }

    return response.json() as Promise<ProofResult>;
  }

  async fetchPolicyJson(policyId: string): Promise<string> {
    const response = await fetch(
      `${this.config.policy_service_url}/api/v1/policies/${policyId}/compile`
    );

    if (!response.ok) {
      throw new Error(`Policy service error (${response.status}): Failed to fetch policy ${policyId}`);
    }

    const body = await response.json() as { success: boolean; data: unknown };
    if (!body.success) {
      throw new Error(`Policy compilation failed for ${policyId}`);
    }

    return JSON.stringify(body.data);
  }

  buildPaymentHeader(
    payment: PaymentRequest,
    proof: ProofResult
  ): X402PaymentHeader {
    return {
      version: '1',
      scheme: 'exact',
      network: this.config.network,
      token: payment.token_mint,
      amount: payment.amount.toString(),
      recipient: payment.recipient_address,
      extra: {
        aperture_proof_hash: proof.proof_hash,
        aperture_policy_id: payment.policy_id,
        aperture_operator_id: payment.operator_id,
      },
    };
  }

  buildProofHeader(proof: ProofResult): X402ProofHeader {
    return {
      proof_hash: proof.proof_hash,
      is_compliant: proof.is_compliant,
      amount_range: {
        min: proof.amount_range.min,
        max: proof.amount_range.max,
      },
      verification_timestamp: proof.verification_timestamp.toISOString(),
    };
  }

  encodePaymentHeader(header: X402PaymentHeader): string {
    return Buffer.from(JSON.stringify(header)).toString('base64');
  }

  decodePaymentHeader(encoded: string): X402PaymentHeader {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as X402PaymentHeader;
  }
}
