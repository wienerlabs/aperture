import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  buildVerifyPaymentProofV2WithTransferIx,
  type HookExtraAccount,
} from './anchor/instructions.js';
import {
  deriveOperatorPDA,
  derivePolicyPDA,
  deriveProofRecordPDA,
  type ProgramIds,
} from './anchor/pda.js';
import { readEffectiveDailySpentLamports } from './anchor/operator-state.js';
import {
  ChallengeError,
  OnChainError,
  PolicyViolationError,
} from './errors.js';
import { ProverClient } from './prover.js';
import { ComplianceClient } from './compliance.js';
import type {
  LoadedPolicy,
  PaymentRecording,
  ProveResponse,
  X402Challenge,
  X402PaymentResult,
} from './types.js';
import { base64ToBytes, sha256, toBase64Json } from './util/base.js';

export interface X402FlowOptions {
  readonly connection: Connection;
  readonly wallet: Keypair;
  readonly prover: ProverClient;
  /**
   * When provided, the flow auto-records the proof on compliance-api after a
   * successful on-chain verify and tries to mint a Light Protocol
   * compressed attestation. Failures here do not roll back the on-chain
   * settlement; they just surface as `recording = null`.
   */
  readonly compliance?: ComplianceClient;
  readonly programs?: ProgramIds;
  /**
   * Optional resolver for SPL Token-2022 transfer-hook extra accounts. Only
   * needed when the mint carries the TransferHook extension (e.g. aUSDC).
   * For plain SPL Token mints (USDC, USDT) leave undefined.
   */
  readonly hookAccountsResolver?: (
    mint: PublicKey,
  ) => Promise<readonly HookExtraAccount[] | undefined>;
  readonly fetch?: typeof fetch;
}

/**
 * Drives an HTTP 402 (x402) payment cycle end-to-end:
 *   1. GET the protected endpoint, parse the 402 challenge.
 *   2. Apply local policy gates (token / amount / category).
 *   3. Read on-chain OperatorState so the proof binds to the real
 *      daily_spent_before the verifier will recompute.
 *   4. Generate a Groth16 proof via the prover-service.
 *   5. Submit a single Anchor instruction that verifies the proof, byte-
 *      binds it to the inner SPL Token transfer, and settles the transfer.
 *   6. Replay the GET with the proof header so the resource server returns
 *      its data.
 */
export class X402Flow {
  private readonly opts: X402FlowOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: X402FlowOptions) {
    this.opts = options;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async pay(
    endpoint: string,
    policy: LoadedPolicy,
  ): Promise<X402PaymentResult> {
    const challenge = await this.fetchChallenge(endpoint);
    this.gate(challenge, policy);

    const operator = this.opts.wallet.publicKey;
    const dailySpentBefore = await readEffectiveDailySpentLamports(
      this.opts.connection,
      operator,
      this.opts.programs,
    );
    const nowUnix = Math.floor(Date.now() / 1000);

    const amountLamports = parseInt(challenge.paymentRequirement.amount, 10);
    const proof = await this.opts.prover.generateProof({
      compiledPolicy: policy.compiled,
      paymentRecipient: challenge.paymentRequirement.recipient,
      paymentTokenMint: challenge.paymentRequirement.token,
      paymentAmountLamports: amountLamports,
      paymentEndpointCategory: 'x402',
      dailySpentBeforeLamports: dailySpentBefore,
      currentUnixSeconds: nowUnix,
    });

    const { txSig, proofRecordPda } = await this.submitOnChain(
      proof,
      policy,
      challenge,
      amountLamports,
    );

    const response = await this.replay(endpoint, txSig, proof);
    const recording = await this.recordProof(
      proof,
      policy,
      challenge,
      amountLamports,
      txSig,
    );
    return {
      txSignature: txSig,
      proofRecordPda,
      amountLamports,
      tokenMint: challenge.paymentRequirement.token,
      recipient: challenge.paymentRequirement.recipient,
      response,
      recording,
    };
  }

  private async recordProof(
    proof: ProveResponse,
    policy: LoadedPolicy,
    challenge: X402Challenge,
    amountLamports: number,
    txSignature: string,
  ): Promise<PaymentRecording | null> {
    const compliance = this.opts.compliance;
    if (!compliance) return null;
    const operatorId = this.opts.wallet.publicKey.toBase58();
    try {
      const row = await compliance.submitProof({
        operatorId,
        policyId: policy.id,
        paymentId: `sdk-x402-${Date.now()}-${txSignature.slice(0, 8)}`,
        tokenMint: challenge.paymentRequirement.token,
        amountLamports,
        proof,
        txSignature,
      });
      let compressed: string | null = null;
      if (proof.is_compliant) {
        compressed = await compliance
          .mintCompressedAttestation(row.id, operatorId)
          .catch(() => null);
      }
      return { proofRowId: row.id, compressedAttestationTx: compressed };
    } catch {
      return null;
    }
  }

  private async fetchChallenge(endpoint: string): Promise<X402Challenge> {
    const res = await this.fetchImpl(endpoint);
    if (res.status !== 402) {
      throw new ChallengeError(
        `x402 endpoint ${endpoint} returned ${res.status} instead of 402`,
      );
    }
    const body = (await res.json()) as Partial<X402Challenge>;
    if (
      !body.paymentRequirement ||
      typeof body.paymentRequirement.token !== 'string' ||
      typeof body.paymentRequirement.amount !== 'string' ||
      typeof body.paymentRequirement.recipient !== 'string'
    ) {
      throw new ChallengeError(
        'x402 challenge missing or malformed paymentRequirement',
      );
    }
    return body as X402Challenge;
  }

  private gate(challenge: X402Challenge, policy: LoadedPolicy): void {
    const req = challenge.paymentRequirement;
    const amount = parseInt(req.amount, 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ChallengeError(`x402 amount ${req.amount} is not a positive integer`);
    }
    if (!policy.tokenWhitelist.includes(req.token)) {
      throw new PolicyViolationError(
        `token ${req.token} is not on the policy whitelist`,
      );
    }
    if (amount > policy.maxPerTxLamports) {
      throw new PolicyViolationError(
        `amount ${amount} exceeds max_per_transaction ${policy.maxPerTxLamports}`,
      );
    }
    if (!policy.allowedCategories.includes('x402')) {
      throw new PolicyViolationError('category "x402" is not allowed by the active policy');
    }
    if (policy.blockedAddresses.includes(req.recipient)) {
      throw new PolicyViolationError(
        `recipient ${req.recipient} is on the blocked addresses list`,
      );
    }
  }

  private async submitOnChain(
    proof: ProveResponse,
    policy: LoadedPolicy,
    challenge: X402Challenge,
    amountLamports: number,
  ): Promise<{ txSig: string; proofRecordPda: string }> {
    const operator = this.opts.wallet.publicKey;
    const policyIdBytes = sha256(policy.id);
    const [operatorAccount] = deriveOperatorPDA(operator, this.opts.programs);
    const [policyAccount] = derivePolicyPDA(
      operatorAccount,
      policyIdBytes,
      this.opts.programs,
    );
    if (policyAccount.toBase58() !== policy.onchainPda) {
      throw new OnChainError(
        `Derived policy PDA ${policyAccount.toBase58()} does not match the policy-service record ${policy.onchainPda}. Re-anchor the policy from the dashboard.`,
      );
    }

    const proofA = base64ToBytes(proof.groth16.proof_a);
    const proofB = base64ToBytes(proof.groth16.proof_b);
    const proofC = base64ToBytes(proof.groth16.proof_c);
    const publicInputs = proof.groth16.public_inputs.map(base64ToBytes);
    const [proofRecordPDA] = deriveProofRecordPDA(
      operator,
      publicInputs[1],
      this.opts.programs,
    );

    const mintPubkey = new PublicKey(challenge.paymentRequirement.token);
    const recipientPubkey = new PublicKey(challenge.paymentRequirement.recipient);

    const mintInfo = await this.opts.connection.getAccountInfo(mintPubkey, 'confirmed');
    if (!mintInfo) {
      throw new OnChainError(
        `mint ${mintPubkey.toBase58()} not found on the connected cluster`,
      );
    }
    const tokenProgramId = mintInfo.owner;
    const isToken2022 = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID);
    const isToken1 = tokenProgramId.equals(TOKEN_PROGRAM_ID);
    if (!isToken1 && !isToken2022) {
      throw new OnChainError(
        `mint ${mintPubkey.toBase58()} is owned by ${tokenProgramId.toBase58()}, neither SPL Token nor SPL Token-2022`,
      );
    }

    const sourceAta = await getAssociatedTokenAddress(
      mintPubkey,
      operator,
      false,
      tokenProgramId,
    );
    const destAta = await getAssociatedTokenAddress(
      mintPubkey,
      recipientPubkey,
      false,
      tokenProgramId,
    );

    const destInfo = await this.opts.connection.getAccountInfo(destAta, 'confirmed');
    if (!destInfo) {
      await this.createAta(destAta, recipientPubkey, mintPubkey, tokenProgramId);
    }

    const hookExtraAccounts = isToken2022 && this.opts.hookAccountsResolver
      ? await this.opts.hookAccountsResolver(mintPubkey)
      : undefined;

    const verifyIx = buildVerifyPaymentProofV2WithTransferIx(
      {
        operator,
        payer: operator,
        policyAccount,
        operatorAccount,
        sourceTokenAccount: sourceAta,
        destinationTokenAccount: destAta,
        mint: mintPubkey,
        tokenProgram: tokenProgramId,
        proofA,
        proofB,
        proofC,
        publicInputs,
        transferAmount: BigInt(amountLamports),
        hookExtraAccounts,
      },
      this.opts.programs,
    );

    const txSig = await this.sendAndConfirm([verifyIx]);
    return { txSig, proofRecordPda: proofRecordPDA.toBase58() };
  }

  private async createAta(
    destAta: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
    tokenProgram: PublicKey,
  ): Promise<void> {
    const payer = this.opts.wallet.publicKey;
    const ix = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      destAta,
      owner,
      mint,
      tokenProgram,
    );
    try {
      await this.sendAndConfirm([ix]);
    } catch (err) {
      throw new OnChainError(
        `failed to create recipient ATA ${destAta.toBase58()}`,
        err,
      );
    }
  }

  private async sendAndConfirm(
    ixs: readonly TransactionInstruction[],
  ): Promise<string> {
    const tx = new Transaction();
    for (const ix of ixs) tx.add(ix);
    tx.feePayer = this.opts.wallet.publicKey;
    const { blockhash } = await this.opts.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(this.opts.wallet);
    try {
      const sig = await this.opts.connection.sendRawTransaction(tx.serialize());
      await this.opts.connection.confirmTransaction(sig, 'confirmed');
      return sig;
    } catch (err) {
      throw new OnChainError(
        `verify_payment_proof_v2_with_transfer submission failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  private async replay(
    endpoint: string,
    txSignature: string,
    proof: ProveResponse,
  ): Promise<Response> {
    const header = toBase64Json({
      txSignature,
      payer: this.opts.wallet.publicKey.toBase58(),
      zkProofHash: proof.policy_data_hash_hex,
    });
    const res = await this.fetchImpl(endpoint, {
      headers: { 'Content-Type': 'application/json', 'x-402-payment': header },
    });
    if (!res.ok) {
      throw new OnChainError(
        `x402 retry GET returned HTTP ${res.status} after successful on-chain verify (tx=${txSignature})`,
      );
    }
    return res;
  }
}
