import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import type { PaymentRequest, ProofResult, ProofRequest } from '@aperture/types';
import type {
  MPPConfig,
  MPPPaymentInstruction,
  MPPProofAttachment,
  MPPChallenge,
  MPPCredential,
  MPPResult,
} from './types.js';

export class MPPAdapter {
  private readonly connection: Connection;
  private readonly config: MPPConfig;

  constructor(config: MPPConfig, rpcUrl: string) {
    this.config = config;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  async validatePaymentRequest(
    payment: PaymentRequest,
  ): Promise<{ valid: boolean; error: string | null }> {
    const token = this.config.supported_tokens.find(
      (t) => t.mint_address === payment.token_mint,
    );

    if (!token) {
      return {
        valid: false,
        error: `Unsupported token mint: ${payment.token_mint}`,
      };
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

  async checkTokenBalance(
    walletAddress: string,
    tokenMint: string,
  ): Promise<number> {
    const wallet = new PublicKey(walletAddress);
    const mint = new PublicKey(tokenMint);
    const ata = await getAssociatedTokenAddress(mint, wallet);

    try {
      const account = await getAccount(this.connection, ata);
      const token = this.config.supported_tokens.find(
        (t) => t.mint_address === tokenMint,
      );
      const decimals = token?.decimals ?? 6;
      return Number(account.amount) / Math.pow(10, decimals);
    } catch {
      return 0;
    }
  }

  buildProofRequest(
    payment: PaymentRequest,
    policyJson: string,
  ): ProofRequest {
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
      throw new Error(
        `Prover service error (${response.status}): ${errorBody}`,
      );
    }

    return response.json() as Promise<ProofResult>;
  }

  async fetchPolicyJson(policyId: string): Promise<string> {
    const response = await fetch(
      `${this.config.policy_service_url}/api/v1/policies/${policyId}/compile`,
    );

    if (!response.ok) {
      throw new Error(
        `Policy service error (${response.status}): Failed to fetch policy ${policyId}`,
      );
    }

    const body = (await response.json()) as {
      success: boolean;
      data: unknown;
    };
    if (!body.success) {
      throw new Error(`Policy compilation failed for ${policyId}`);
    }

    return JSON.stringify(body.data);
  }

  buildPaymentInstruction(
    payment: PaymentRequest,
    proof: ProofResult | null,
  ): MPPPaymentInstruction {
    const token = this.config.supported_tokens.find(
      (t) => t.mint_address === payment.token_mint,
    );
    const decimals = token?.decimals ?? 6;
    const amountLamports = Math.round(
      payment.amount * Math.pow(10, decimals),
    );

    const proofAttachment: MPPProofAttachment | null = proof
      ? {
          aperture_proof_hash: proof.proof_hash,
          aperture_policy_id: payment.policy_id,
          aperture_operator_id: payment.operator_id,
          is_compliant: proof.is_compliant,
          amount_range: {
            min: proof.amount_range.min,
            max: proof.amount_range.max,
          },
          verification_timestamp: proof.verification_timestamp.toISOString(),
        }
      : null;

    return {
      version: '1.0',
      protocol: 'mpp',
      network: this.config.network,
      token_mint: payment.token_mint,
      amount_lamports: amountLamports.toString(),
      sender: payment.sender_address,
      recipient: payment.recipient_address,
      memo: payment.memo,
      proof_attachment: proofAttachment,
    };
  }

  /**
   * Parse MPP 402 challenge from response body.
   */
  parseMPPChallenge(responseBody: {
    mppChallenge?: MPPChallenge;
  }): MPPChallenge | null {
    return responseBody.mppChallenge ?? null;
  }

  /**
   * Build MPP credential for retrying after payment.
   */
  buildCredential(challenge: MPPChallenge): string {
    const credential: MPPCredential = {
      challengeId: challenge.id,
      paymentIntentId: challenge.stripe.paymentIntentId,
    };
    return Buffer.from(JSON.stringify(credential)).toString('base64');
  }

  /**
   * Execute the full MPP flow: request -> 402 -> pay -> retry.
   * Returns the final result with payment info.
   */
  async fetchWithMPP<T>(
    endpoint: string,
    confirmPayment: (challenge: MPPChallenge) => Promise<string>,
  ): Promise<MPPResult<T>> {
    // Step 1: Initial request (expect 402)
    const initialRes = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (initialRes.ok) {
      const body = (await initialRes.json()) as { data: T };
      return { success: true, data: body.data, payment: null, error: null };
    }

    if (initialRes.status !== 402) {
      const body = (await initialRes
        .json()
        .catch(() => ({ error: initialRes.statusText }))) as { error?: string };
      return {
        success: false,
        data: null,
        payment: null,
        error: body.error ?? `HTTP ${initialRes.status}`,
      };
    }

    // Step 2: Parse challenge
    const challengeBody = (await initialRes.json()) as { mppChallenge?: MPPChallenge };
    const challenge = this.parseMPPChallenge(challengeBody);

    if (!challenge) {
      return {
        success: false,
        data: null,
        payment: null,
        error: 'Invalid 402 response: no mppChallenge',
      };
    }

    // Step 3: Confirm payment (caller handles Stripe interaction)
    const paymentIntentId = await confirmPayment(challenge);

    // Step 4: Build credential and retry
    const credential: MPPCredential = {
      challengeId: challenge.id,
      paymentIntentId,
    };
    const encodedCredential = Buffer.from(JSON.stringify(credential)).toString(
      'base64',
    );

    const paidRes = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'x-mpp-credential': encodedCredential,
      },
    });

    const paymentInfo = {
      protocol: 'mpp' as const,
      paymentIntentId,
      amount: challenge.request.amount,
      currency: challenge.request.currency,
      zkProofHash: null as string | null,
    };

    if (!paidRes.ok) {
      const body = (await paidRes
        .json()
        .catch(() => ({ error: paidRes.statusText }))) as { error?: string };
      return {
        success: false,
        data: null,
        payment: paymentInfo,
        error:
          body.error ??
          `Payment accepted but report failed: HTTP ${paidRes.status}`,
      };
    }

    const body = (await paidRes.json()) as { data: T };
    return {
      success: true,
      data: body.data,
      payment: paymentInfo,
      error: null,
    };
  }

  encodeInstruction(instruction: MPPPaymentInstruction): string {
    return Buffer.from(JSON.stringify(instruction)).toString('base64');
  }

  decodeInstruction(encoded: string): MPPPaymentInstruction {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as MPPPaymentInstruction;
  }
}
