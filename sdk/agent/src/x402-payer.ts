import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

interface X402PaymentRequirement {
  readonly version: string;
  readonly scheme: string;
  readonly network: string;
  readonly token: string;
  readonly amount: string;
  readonly recipient: string;
  readonly description: string;
  readonly resource: string;
}

export interface X402PayResult {
  readonly success: boolean;
  readonly txSignature: string | null;
  readonly data: unknown;
  readonly error: string | null;
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [Aperture Agent] ${msg}`);
}

export class X402Payer {
  private readonly connection: Connection;
  private readonly wallet: Keypair;
  private readonly complianceApiUrl: string;

  constructor(rpcUrl: string, wallet: Keypair, complianceApiUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.wallet = wallet;
    this.complianceApiUrl = complianceApiUrl;
  }

  async payForReport(
    operatorId: string,
    zkProofHash: string | null,
  ): Promise<X402PayResult> {
    const endpoint = `${this.complianceApiUrl}/api/v1/compliance/protected-report?operator_id=${operatorId}`;

    log(`Paying via x402: /compliance/protected-report`);

    // Step 1: GET -> 402
    const initialRes = await fetch(endpoint, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (initialRes.ok) {
      const body = (await initialRes.json()) as { data: unknown };
      return { success: true, txSignature: null, data: body.data, error: null };
    }

    if (initialRes.status !== 402) {
      const body = (await initialRes.json().catch(() => ({
        error: initialRes.statusText,
      }))) as { error?: string };
      return {
        success: false,
        txSignature: null,
        data: null,
        error: body.error ?? `HTTP ${initialRes.status}`,
      };
    }

    // Step 2: Parse payment requirement
    const paymentBody = (await initialRes.json()) as {
      paymentRequirement?: X402PaymentRequirement;
    };
    const requirement = paymentBody.paymentRequirement;

    if (!requirement) {
      return {
        success: false,
        txSignature: null,
        data: null,
        error: 'Invalid 402 response: no paymentRequirement',
      };
    }

    const amountLamports = parseInt(requirement.amount, 10);
    const usdcMint = new PublicKey(requirement.token);
    const recipient = new PublicKey(requirement.recipient);

    log(
      `  Amount: ${amountLamports / 1_000_000} USDC -> ${requirement.recipient.slice(0, 8)}...`,
    );

    // Step 3: Build and send USDC transfer
    const payerAta = await getAssociatedTokenAddress(
      usdcMint,
      this.wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID,
    );
    const recipientAta = await getAssociatedTokenAddress(
      usdcMint,
      recipient,
      false,
      TOKEN_PROGRAM_ID,
    );

    const transferIx = createTransferCheckedInstruction(
      payerAta,
      usdcMint,
      recipientAta,
      this.wallet.publicKey,
      amountLamports,
      6,
      [],
      TOKEN_PROGRAM_ID,
    );

    const tx = new Transaction().add(transferIx);
    tx.feePayer = this.wallet.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(this.wallet);

    const txSignature = await this.connection.sendRawTransaction(
      tx.serialize(),
    );
    await this.connection.confirmTransaction(txSignature, 'confirmed');

    log(
      `  Payment verified on-chain: https://explorer.solana.com/tx/${txSignature}?cluster=devnet`,
    );

    // Step 4: Retry with x-402-payment header
    const proof = {
      txSignature,
      payer: this.wallet.publicKey.toBase58(),
      zkProofHash,
    };
    const encodedProof = Buffer.from(JSON.stringify(proof)).toString('base64');

    const paidRes = await fetch(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'x-402-payment': encodedProof,
      },
    });

    if (!paidRes.ok) {
      const body = (await paidRes.json().catch(() => ({
        error: paidRes.statusText,
      }))) as { error?: string };
      return {
        success: false,
        txSignature,
        data: null,
        error: body.error ?? `Report fetch failed: HTTP ${paidRes.status}`,
      };
    }

    const body = (await paidRes.json()) as { data: unknown };
    return { success: true, txSignature, data: body.data, error: null };
  }
}
