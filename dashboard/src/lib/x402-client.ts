/**
 * x402 payment client for the dashboard.
 * Handles the full x402 flow: request -> 402 -> ZK proof -> pay -> retry with proof.
 */
import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { config } from './config';

const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const USDC_DECIMALS = 6;

export interface X402PaymentRequirement {
  readonly version: string;
  readonly scheme: string;
  readonly network: string;
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
  readonly description: string;
  readonly resource: string;
}

export interface X402Result<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly payment: {
    readonly txSignature: string;
    readonly payer: string;
    readonly amount: string;
    readonly recipient: string;
    readonly zkProofHash: string | null;
  } | null;
  readonly error: string | null;
}

/**
 * Fetch a resource with x402 payment flow.
 * 1. Makes initial request
 * 2. If 402 returned, generates ZK proof via prover service
 * 3. Builds USDC transfer and signs with connected wallet
 * 4. Retries request with x-402-payment header containing tx + zkProofHash
 */
export async function fetchWithX402<T>(
  endpoint: string,
  connection: Connection,
  publicKey: PublicKey,
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>,
): Promise<X402Result<T>> {
  // Step 1: Initial request (expect 402)
  const initialRes = await fetch(endpoint, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (initialRes.ok) {
    const body = await initialRes.json();
    return { success: true, data: body.data, payment: null, error: null };
  }

  if (initialRes.status !== 402) {
    const body = await initialRes.json().catch(() => ({ error: initialRes.statusText }));
    return { success: false, data: null, payment: null, error: body.error ?? `HTTP ${initialRes.status}` };
  }

  // Step 2: Parse 402 payment requirements
  const paymentBody = await initialRes.json();
  const requirement: X402PaymentRequirement = paymentBody.paymentRequirement;

  if (!requirement) {
    return { success: false, data: null, payment: null, error: 'Invalid 402 response: no paymentRequirement' };
  }

  const amountLamports = parseInt(requirement.amount, 10);
  const recipient = new PublicKey(requirement.recipient);

  // Step 3: Generate ZK proof via prover service
  let zkProofHash: string | null = null;
  if (config.proverServiceUrl) {
    try {
      const proveRes = await fetch(`${config.proverServiceUrl}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy_id: 'x402-payment',
          operator_id: publicKey.toBase58(),
          max_daily_spend_lamports: 100_000_000,
          max_per_transaction_lamports: amountLamports,
          allowed_endpoint_categories: ['x402'],
          blocked_addresses: [],
          token_whitelist: [USDC_MINT.toBase58()],
          payment_amount_lamports: amountLamports,
          payment_token_mint: USDC_MINT.toBase58(),
          payment_recipient: recipient.toBase58(),
          payment_endpoint_category: 'x402',
          payment_timestamp: new Date().toISOString(),
          daily_spent_so_far_lamports: 0,
        }),
      });
      if (proveRes.ok) {
        const proofData = await proveRes.json();
        zkProofHash = proofData.proof_hash;
      }
    } catch {
      // Prover unavailable -- proceed without ZK proof
    }
  }

  // Step 4: Build USDC transfer transaction
  const payerAta = await getAssociatedTokenAddress(USDC_MINT, publicKey, false, TOKEN_PROGRAM_ID);
  const recipientAta = await getAssociatedTokenAddress(USDC_MINT, recipient, false, TOKEN_PROGRAM_ID);

  const transferIx = createTransferCheckedInstruction(
    payerAta,
    USDC_MINT,
    recipientAta,
    publicKey,
    amountLamports,
    USDC_DECIMALS,
    [],
    TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(transferIx);
  tx.feePayer = publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  // Step 5: Sign and send with connected wallet (triggers wallet popup)
  const txSignature = await sendTransaction(tx, connection);
  await connection.confirmTransaction(txSignature, 'confirmed');

  // Step 6: Build payment proof header with ZK proof hash
  const proof = {
    txSignature,
    payer: publicKey.toBase58(),
    zkProofHash,
  };
  const encodedProof = Buffer.from(JSON.stringify(proof)).toString('base64');

  // Step 7: Retry with payment proof
  const paidRes = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      'x-402-payment': encodedProof,
    },
  });

  const paymentInfo = {
    txSignature,
    payer: publicKey.toBase58(),
    amount: `${amountLamports / 10 ** USDC_DECIMALS} USDC`,
    recipient: recipient.toBase58(),
    zkProofHash,
  };

  if (!paidRes.ok) {
    const body = await paidRes.json().catch(() => ({ error: paidRes.statusText }));
    return {
      success: false,
      data: null,
      payment: paymentInfo,
      error: body.error ?? `Payment accepted but report failed: HTTP ${paidRes.status}`,
    };
  }

  const body = await paidRes.json();
  return {
    success: true,
    data: body.data,
    payment: paymentInfo,
    error: null,
  };
}
