import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  buildEd25519VerifyIx,
  buildVerifyMppPaymentProofIx,
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
  StripeError,
} from './errors.js';
import { ProverClient } from './prover.js';
import { ComplianceClient } from './compliance.js';
import type {
  LoadedPolicy,
  MppPaymentResult,
  MPPChallenge,
  PaymentRecording,
  ProveResponse,
  StripeConfirmer,
  StripeCredentials,
  VerifiedStripeReceipt,
} from './types.js';
import { base64ToBytes, hexToBytes32, sha256, toBase64Json } from './util/base.js';
import { pollUntil } from './util/poll.js';

/**
 * Default cents-to-policy-lamports rate. Aperture policies cap in 6-decimal
 * USDC lamports and MPP bills in fiat cents; 1 cent = 10_000 lamports keeps
 * the ceiling check 1:1. A production deployment with a real FX feed would
 * override this via `MppFlowOptions.centsToLamports`.
 */
export const DEFAULT_CENTS_TO_LAMPORTS = 10_000;

export interface MppFlowOptions {
  readonly connection: Connection;
  readonly wallet: Keypair;
  readonly prover: ProverClient;
  readonly complianceApiUrl: string;
  /**
   * Confirms a Stripe PaymentIntent. Default flow does an off_session direct
   * confirm via the Stripe REST API; consumers can swap in SCA or hosted
   * checkout flows by supplying their own confirmer.
   */
  readonly stripeConfirmer: StripeConfirmer;
  /** Resolves the Stripe customer + payment method for a given operator. */
  readonly stripeCredentialsResolver: (
    operatorId: string,
  ) => Promise<StripeCredentials | null>;
  /** When set, auto-records ProofRecord + compressed attestation post-tx. */
  readonly compliance?: ComplianceClient;
  readonly programs?: ProgramIds;
  /** Override the cents → lamports conversion for the policy ceiling check. */
  readonly centsToLamports?: number;
  /** Timeout for polling the verified-receipt endpoint, default 30s. */
  readonly receiptPollTimeoutMs?: number;
  readonly fetch?: typeof fetch;
}

/**
 * Default off_session Stripe confirmer. Performs the direct REST call the
 * production agent makes. Throws `StripeError` on non-succeeded status so
 * the SDK can surface the failure cleanly.
 *
 * The secret key is taken as an argument rather than from env so the SDK
 * stays free of side effects and can be re-used across operators with
 * different keys (e.g. Stripe Connect).
 */
export function createStripeOffSessionConfirmer(
  stripeSecretKey: string,
  fetchImpl: typeof fetch = fetch,
): StripeConfirmer {
  return async ({ paymentIntentId, credentials }) => {
    const res = await fetchImpl(
      `https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${stripeSecretKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          payment_method: credentials.paymentMethodId,
          off_session: 'true',
        }).toString(),
      },
    );
    const body = (await res.json()) as {
      id?: string;
      status?: string;
      last_payment_error?: { message?: string };
      error?: { message?: string };
    };
    if (body.status !== 'succeeded') {
      const reason =
        body.last_payment_error?.message ??
        body.error?.message ??
        `status=${body.status} (HTTP ${res.status})`;
      throw new StripeError(`Stripe off_session confirm failed: ${reason}`);
    }
    return { id: body.id ?? paymentIntentId, status: body.status };
  };
}

/**
 * Default credentials resolver: queries compliance-api for credentials that
 * the operator pre-configured via the dashboard.
 */
export function createDashboardStripeCredentialsResolver(
  complianceApiUrl: string,
  fetchImpl: typeof fetch = fetch,
): (operatorId: string) => Promise<StripeCredentials | null> {
  const base = complianceApiUrl.replace(/\/$/, '');
  return async (operatorId) => {
    const res = await fetchImpl(
      `${base}/api/v1/agent/stripe/credentials/${operatorId}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      readonly data?: {
        readonly stripe_customer_id: string;
        readonly stripe_payment_method_id: string;
      };
    };
    if (!body.data) return null;
    return {
      customerId: body.data.stripe_customer_id,
      paymentMethodId: body.data.stripe_payment_method_id,
    };
  };
}

export class MppFlow {
  private readonly opts: Required<
    Pick<
      MppFlowOptions,
      'centsToLamports' | 'receiptPollTimeoutMs'
    >
  > &
    MppFlowOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MppFlowOptions) {
    this.opts = {
      centsToLamports: options.centsToLamports ?? DEFAULT_CENTS_TO_LAMPORTS,
      receiptPollTimeoutMs: options.receiptPollTimeoutMs ?? 30_000,
      ...options,
    };
    this.fetchImpl = options.fetch ?? fetch;
  }

  async pay(
    endpoint: string,
    policy: LoadedPolicy,
    operatorId: string,
  ): Promise<MppPaymentResult> {
    if (!policy.allowedCategories.includes('mpp')) {
      throw new PolicyViolationError('category "mpp" is not allowed by the active policy');
    }

    const challenge = await this.fetchChallenge(endpoint);
    const amountCents = Math.round(parseFloat(challenge.mppChallenge.request.amount) * 100);
    if (amountCents <= 0) {
      throw new ChallengeError(
        `MPP challenge amount ${challenge.mppChallenge.request.amount} must be positive`,
      );
    }
    const amountLamports = amountCents * this.opts.centsToLamports;
    if (amountLamports > policy.maxPerTxLamports) {
      throw new PolicyViolationError(
        `MPP amount ${amountLamports} lamports exceeds max_per_transaction ${policy.maxPerTxLamports}`,
      );
    }

    const credentials = await this.opts.stripeCredentialsResolver(operatorId);
    if (!credentials) {
      throw new StripeError(
        `No Stripe customer + payment method on file for operator ${operatorId}. Provision them from the Aperture dashboard before running MPP.`,
      );
    }

    const confirmed = await this.opts.stripeConfirmer({
      paymentIntentId: challenge.mppChallenge.stripe.paymentIntentId,
      credentials,
    });

    const receipt = await this.pollVerifiedReceipt(confirmed.id);
    if (!receipt) {
      throw new StripeError(
        `Could not finalize the verified Stripe receipt for ${confirmed.id} within ${this.opts.receiptPollTimeoutMs}ms`,
      );
    }

    const operator = this.opts.wallet.publicKey;
    const dailySpentBefore = await readEffectiveDailySpentLamports(
      this.opts.connection,
      operator,
      this.opts.programs,
    );
    const nowUnix = Math.floor(Date.now() / 1000);
    const stripeReceiptDecimal = BigInt('0x' + receipt.poseidon_hash_hex).toString();

    const whitelist = policy.compiled.token_whitelist;
    const sentinelMint =
      whitelist.find((m) => m === '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU') ??
      whitelist[0];
    if (!sentinelMint) {
      throw new PolicyViolationError(
        'MPP cycle needs at least one whitelisted token mint to use as a sentinel for the proof recipient/mint',
      );
    }

    const proof = await this.opts.prover.generateProof({
      compiledPolicy: policy.compiled,
      paymentRecipient: operator.toBase58(),
      paymentTokenMint: sentinelMint,
      paymentAmountLamports: amountLamports,
      paymentEndpointCategory: 'mpp',
      dailySpentBeforeLamports: dailySpentBefore,
      currentUnixSeconds: nowUnix,
      stripeReceiptHash: stripeReceiptDecimal,
    });

    const policyIdBytes = sha256(policy.id);
    const [operatorAccount] = deriveOperatorPDA(operator, this.opts.programs);
    const [policyAccount] = derivePolicyPDA(
      operatorAccount,
      policyIdBytes,
      this.opts.programs,
    );

    const proofA = base64ToBytes(proof.groth16.proof_a);
    const proofB = base64ToBytes(proof.groth16.proof_b);
    const proofC = base64ToBytes(proof.groth16.proof_c);
    const publicInputs = proof.groth16.public_inputs.map(base64ToBytes);

    const signature = bs58.decode(receipt.authority_signature_b58);
    if (signature.length !== 64) {
      throw new OnChainError(
        'MPP authority signature is not 64 bytes — compliance-api persisted bad data',
      );
    }
    const authorityPubkey = new PublicKey(receipt.authority_pubkey_b58);
    const message = hexToBytes32(receipt.poseidon_hash_hex);

    const ed25519Ix = buildEd25519VerifyIx(authorityPubkey, signature, message);
    const verifyIx = buildVerifyMppPaymentProofIx(
      {
        operator,
        payer: operator,
        policyAccount,
        operatorAccount,
        proofA,
        proofB,
        proofC,
        publicInputs,
      },
      this.opts.programs,
    );

    const txSig = await this.sendAndConfirm([ed25519Ix, verifyIx]);
    const [proofRecordPDA] = deriveProofRecordPDA(
      operator,
      publicInputs[1],
      this.opts.programs,
    );

    const response = await this.replay(endpoint, challenge, confirmed.id, proofRecordPDA);
    const recording = await this.recordProof(
      proof,
      policy,
      amountLamports,
      txSig,
    );
    return {
      txSignature: txSig,
      proofRecordPda: proofRecordPDA.toBase58(),
      paymentIntentId: confirmed.id,
      amountCents,
      currency: challenge.mppChallenge.request.currency,
      response,
      recording,
    };
  }

  private async recordProof(
    proof: ProveResponse,
    policy: LoadedPolicy,
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
        paymentId: `sdk-mpp-${Date.now()}-${txSignature.slice(0, 8)}`,
        tokenMint: 'usd',
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

  private async fetchChallenge(endpoint: string): Promise<MPPChallenge> {
    const res = await this.fetchImpl(endpoint);
    if (res.status !== 402) {
      throw new ChallengeError(
        `MPP endpoint ${endpoint} returned ${res.status} instead of 402`,
      );
    }
    const body = (await res.json()) as Partial<MPPChallenge>;
    if (
      !body.mppChallenge ||
      !body.mppChallenge.stripe?.paymentIntentId ||
      !body.mppChallenge.request?.amount
    ) {
      throw new ChallengeError('MPP challenge missing or malformed');
    }
    return body as MPPChallenge;
  }

  private async pollVerifiedReceipt(
    paymentIntentId: string,
  ): Promise<VerifiedStripeReceipt | null> {
    const base = this.opts.complianceApiUrl.replace(/\/$/, '');
    const readUrl = `${base}/api/v1/compliance/verified-payment/${paymentIntentId}`;
    const syncUrl = `${base}/api/v1/compliance/verified-payment/sync/${paymentIntentId}`;
    const start = Date.now();
    const fastPathBudget = 2_000;

    // Fast path: read the webhook-fed row.
    const fast = await pollUntil(
      async () => {
        try {
          const res = await this.fetchImpl(readUrl);
          if (!res.ok) return null;
          const body = (await res.json()) as { readonly data?: VerifiedStripeReceipt };
          return body.data?.poseidon_hash_hex ? body.data : null;
        } catch {
          return null;
        }
      },
      { timeoutMs: fastPathBudget, intervalMs: 500 },
    );
    if (fast) return fast;

    // Slow path: ask the compliance-api to pull from Stripe directly.
    const remaining = Math.max(this.opts.receiptPollTimeoutMs - (Date.now() - start), 12_000);
    return pollUntil(
      async () => {
        try {
          const res = await this.fetchImpl(syncUrl, { method: 'POST' });
          if (!res.ok) {
            // 409 = PI not yet succeeded → retry. Anything else is fatal.
            if (res.status === 409) return null;
            throw new StripeError(`sync endpoint returned HTTP ${res.status}`);
          }
          const body = (await res.json()) as { readonly data?: VerifiedStripeReceipt };
          return body.data?.poseidon_hash_hex ? body.data : null;
        } catch (err) {
          if (err instanceof StripeError) throw err;
          return null;
        }
      },
      { timeoutMs: remaining, intervalMs: 1500 },
    );
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
        `verify_mpp_payment_proof submission failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }

  private async replay(
    endpoint: string,
    challenge: MPPChallenge,
    paymentIntentId: string,
    proofRecordPda: PublicKey,
  ): Promise<Response> {
    const credential = toBase64Json({
      challengeId: challenge.mppChallenge.id,
      paymentIntentId,
    });
    const res = await this.fetchImpl(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'x-mpp-credential': credential,
        'x-aperture-proof-record': proofRecordPda.toBase58(),
      },
    });
    if (!res.ok) {
      throw new OnChainError(
        `MPP retry GET returned HTTP ${res.status} after successful on-chain verify`,
      );
    }
    return res;
  }
}
