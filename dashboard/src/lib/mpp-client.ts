/**
 * MPP B-flow client orchestrator. Drives the full Stripe + ZK + on-chain
 * Solana verification flow for a human user from the dashboard:
 *
 *   1. GET /mpp-protected-service → 402 challenge with PaymentIntent +
 *      clientSecret for Stripe Elements.
 *   2. UI lets the user enter card details and confirms the PaymentIntent
 *      (caller passes the resulting PaymentIntent id back in via
 *      `paymentIntentId` after stripe.confirmCardPayment succeeds).
 *   3. Poll /verified-payment/:id until the compliance-api webhook handler
 *      has persisted the canonical Poseidon hash + ed25519 signature.
 *   4. POST /prove with stripe_receipt_hash = poseidon hash.
 *   5. Build a single Solana tx: Ed25519 verify ix at index 0 + the
 *      verifier's verify_mpp_payment_proof Anchor ix.
 *   6. Replay the protected endpoint with x-mpp-credential and
 *      x-aperture-proof-record headers to unlock the privileged response.
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { config } from './config';
import {
  buildEd25519VerifyIx,
  buildVerifyMppPaymentProofIx,
  deriveOperatorPDA,
  derivePolicyPDA,
  deriveProofRecordPDA,
  readEffectiveDailySpentLamports,
  sha256Bytes,
} from './anchor-instructions';
import { policyApi } from './api';

// Tiny inline base58 decoder. Avoids pulling in the bs58 ESM package solely
// to translate the compliance-api's authority signature into 64 raw bytes.
const BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_MAP: Readonly<Record<string, number>> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) m[BASE58_ALPHABET[i]] = i;
  return m;
})();

function base58Decode(s: string): Uint8Array {
  if (s.length === 0) return new Uint8Array();
  const bytes: number[] = [0];
  for (const c of s) {
    const v = BASE58_MAP[c];
    if (v === undefined) throw new Error(`bad base58 char: ${c}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; k < s.length && s[k] === '1'; k++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

export interface MppChallenge {
  readonly id: string;
  readonly stripe: {
    readonly paymentIntentId: string;
    readonly clientSecret: string;
  };
  readonly request: {
    readonly amount: string;
    readonly currency: string;
    readonly description: string;
  };
}

export interface MppPublicConfig {
  readonly stripe: {
    readonly publishableKey: string | null;
    readonly isTestMode: boolean;
  };
  readonly mppAuthorityPubkey: string | null;
}

/**
 * Stripe Dashboard URL for a given PaymentIntent. Test-mode URLs are scoped
 * under /test/ so the dashboard reads from the sandbox account; live keys
 * land on the production dashboard.
 */
export function getStripeDashboardUrl(
  paymentIntentId: string,
  isTestMode: boolean,
): string {
  return isTestMode
    ? `https://dashboard.stripe.com/test/payments/${paymentIntentId}`
    : `https://dashboard.stripe.com/payments/${paymentIntentId}`;
}

export async function fetchMppPublicConfig(): Promise<MppPublicConfig> {
  const res = await fetch(
    `${config.complianceApiUrl}/api/v1/compliance/mpp/public-config`,
  );
  if (!res.ok) {
    throw new Error(
      `Failed to load MPP public config (HTTP ${res.status}). Is the compliance-api running?`,
    );
  }
  const body = (await res.json()) as { data: MppPublicConfig };
  return body.data;
}

/**
 * Fetches the 402 challenge + Stripe PaymentIntent for the MPP-protected
 * service endpoint. Caller renders the challenge.stripe.clientSecret in
 * Stripe Elements; once the card is confirmed the next steps run in
 * `completeMppFlow`.
 */
export async function fetchMppChallenge(operatorId: string): Promise<{
  endpoint: string;
  challenge: MppChallenge;
}> {
  const endpoint = `${config.complianceApiUrl}/api/v1/compliance/mpp-protected-service?operator_id=${operatorId}`;
  const res = await fetch(endpoint);
  if (res.status !== 402) {
    throw new Error(
      `Expected 402 from /mpp-protected-service, got ${res.status}.`,
    );
  }
  const body = (await res.json()) as { mppChallenge?: MppChallenge };
  if (!body.mppChallenge) {
    throw new Error('Compliance-api did not include mppChallenge in 402 body.');
  }
  return { endpoint, challenge: body.mppChallenge };
}

interface VerifiedReceipt {
  readonly stripe_payment_intent_id: string;
  readonly status: string;
  readonly amount_cents: number;
  readonly currency: string;
  readonly poseidon_hash_hex: string;
  readonly authority_signature_b58: string;
  readonly authority_pubkey_b58: string;
  readonly stripe_paid_at: string;
}

async function pollVerifiedReceipt(
  paymentIntentId: string,
  timeoutMs: number,
  onTick?: (elapsed: number) => void,
): Promise<VerifiedReceipt> {
  const start = Date.now();
  const url = `${config.complianceApiUrl}/api/v1/compliance/verified-payment/${paymentIntentId}`;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { data?: VerifiedReceipt };
        if (body.data?.poseidon_hash_hex) return body.data;
      }
    } catch {
      // ignore transient errors
    }
    onTick?.(Math.floor((Date.now() - start) / 1000));
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `Compliance-api never received the Stripe webhook for ${paymentIntentId} within ${timeoutMs / 1000}s. Production deployments need a public webhook endpoint or stripe listen forwarding.`,
  );
}

export interface CompleteMppArgs {
  readonly connection: Connection;
  readonly publicKey: PublicKey;
  readonly sendTransaction: (
    tx: Transaction,
    connection: Connection,
  ) => Promise<string>;
  readonly operatorId: string;
  readonly endpoint: string;
  readonly challenge: MppChallenge;
  readonly paymentIntentId: string;
  readonly onStatus?: (msg: string) => void;
}

export interface MppFlowResult<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: string | null;
  readonly payment: {
    readonly txSignature: string;
    readonly proofRecordPda: string;
    readonly stripePaymentIntent: string;
    readonly poseidonHash: string;
    readonly amount: string;
  } | null;
}

/**
 * Executes steps 3–6 of the B-flow after the user has confirmed the Stripe
 * PaymentIntent via Stripe Elements in the browser. Pure data flow once
 * `paymentIntentId` is in hand: poll → prove → submit on-chain → replay.
 */
export async function completeMppFlow<T>(
  args: CompleteMppArgs,
): Promise<MppFlowResult<T>> {
  const fail = (error: string): MppFlowResult<T> => ({
    success: false,
    data: null,
    error,
    payment: null,
  });

  const { connection, publicKey, sendTransaction, operatorId, endpoint, challenge, paymentIntentId, onStatus } = args;

  // ---- 1. wait for the signed Stripe webhook to land in the DB --------------
  onStatus?.('Waiting for Stripe webhook…');
  let receipt: VerifiedReceipt;
  try {
    receipt = await pollVerifiedReceipt(paymentIntentId, 60_000, (sec) =>
      onStatus?.(`Waiting for Stripe webhook (${sec}s)…`),
    );
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Stripe webhook timeout');
  }

  // ---- 2. resolve an active, on-chain-anchored policy for the operator -----
  onStatus?.('Loading anchored policy…');

  let policyId: string;
  let policyPda: string;
  let compiled: {
    readonly policy_id: string;
    readonly operator_id: string;
    readonly max_daily_spend_lamports: string;
    readonly max_per_transaction_lamports: string;
    readonly allowed_endpoint_categories: readonly string[];
    readonly blocked_addresses: readonly string[];
    readonly token_whitelist: readonly string[];
    readonly time_restrictions: ReadonlyArray<{
      readonly allowed_days: readonly string[];
      readonly allowed_hours_start: number;
      readonly allowed_hours_end: number;
      readonly timezone: string;
    }>;
  };
  try {
    const policiesRes = await policyApi.list(operatorId);
    const candidates = policiesRes.data.filter(
      (p) => p.is_active && p.onchain_status === 'registered' && p.onchain_pda,
    );
    const policy = candidates.find((p) => p.allowed_endpoint_categories.includes('mpp')) ?? candidates[0];
    if (!policy) {
      return fail(
        'No on-chain-registered policy for this operator. Anchor a policy from the Policies tab first.',
      );
    }
    if (!policy.allowed_endpoint_categories.includes('mpp')) {
      return fail(
        `Active policy "${policy.name}" does not include the "mpp" endpoint category. Edit the policy and re-anchor.`,
      );
    }
    const compileRes = await policyApi.compile(policy.id);
    if (!compileRes.data) {
      return fail('Failed to compile policy.');
    }
    policyId = policy.id;
    policyPda = policy.onchain_pda!;
    compiled = compileRes.data;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Policy load failed');
  }

  // ---- 3. ZK proof binding the Stripe receipt to the policy ----------------
  onStatus?.('Generating ZK proof…');
  const amountCents = receipt.amount_cents;
  const CENTS_TO_LAMPORTS = 10_000;
  const amountLamports = amountCents * CENTS_TO_LAMPORTS;
  const dailySpentBefore = (
    await readEffectiveDailySpentLamports(connection, publicKey)
  ).toString();
  const stripeReceiptDecimal = BigInt('0x' + receipt.poseidon_hash_hex).toString();

  let proofData: {
    is_compliant: boolean;
    policy_data_hash_hex: string;
    proof_hash: string;
    verification_timestamp: string;
    groth16: {
      proof_a: string;
      proof_b: string;
      proof_c: string;
      public_inputs: string[];
    };
  };
  try {
    const proveRes = await fetch(`${config.proverServiceUrl}/prove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policy_id: compiled.policy_id,
        operator_id: compiled.operator_id,
        max_daily_spend_lamports: parseInt(compiled.max_daily_spend_lamports, 10),
        max_per_transaction_lamports: parseInt(compiled.max_per_transaction_lamports, 10),
        allowed_endpoint_categories: compiled.allowed_endpoint_categories,
        blocked_addresses: compiled.blocked_addresses,
        token_whitelist: compiled.token_whitelist,
        time_restrictions: compiled.time_restrictions,
        // The MPP flow has no Solana destination; commit the operator's own
        // pubkey as recipient + a stablecoin sentinel for the mint. Both
        // fields land in the proof's public outputs but the verifier path
        // does not cross-check them against any Solana transfer. Pick the
        // first whitelisted token from the active policy so the ZK
        // is_compliant check can find a match (USDC by default; aUSDC kept
        // as a fallback for legacy policies).
        payment_amount_lamports: amountLamports,
        payment_token_mint:
          compiled.token_whitelist.find((m) => m === config.tokens.usdc) ??
          compiled.token_whitelist[0] ??
          config.tokens.aUSDC,
        payment_recipient: publicKey.toBase58(),
        payment_endpoint_category: 'mpp',
        daily_spent_before_lamports: dailySpentBefore,
        current_unix_timestamp: Math.floor(Date.now() / 1000),
        stripe_receipt_hash: stripeReceiptDecimal,
      }),
    });
    if (!proveRes.ok) {
      const errBody = await proveRes.json().catch(() => ({ error: 'Prover error' }));
      return fail(errBody.error ?? `Prover returned ${proveRes.status}`);
    }
    proofData = await proveRes.json();
    if (!proofData.is_compliant) {
      return fail('Prover reported is_compliant=false — payment violates the active policy.');
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Prove request failed');
  }

  // ---- 4. Build Solana tx: ed25519 verify (ix 0) + verify_mpp_payment_proof
  onStatus?.('Anchoring proof on-chain…');
  const proofA = Uint8Array.from(Buffer.from(proofData.groth16.proof_a, 'base64'));
  const proofB = Uint8Array.from(Buffer.from(proofData.groth16.proof_b, 'base64'));
  const proofC = Uint8Array.from(Buffer.from(proofData.groth16.proof_c, 'base64'));
  const publicInputs = proofData.groth16.public_inputs.map((b64) =>
    Uint8Array.from(Buffer.from(b64, 'base64')),
  );

  // The 32-byte message the ed25519 ix authenticates is the raw bytes of
  // poseidon_hash_hex, NOT the field-element decimal — the on-chain
  // verifier reads public_inputs[9] as 32 BE bytes and the ed25519 message
  // must match byte-for-byte.
  const stripeReceiptHashBytes = Uint8Array.from(
    Buffer.from(receipt.poseidon_hash_hex, 'hex'),
  );
  const authoritySignature = base58Decode(receipt.authority_signature_b58);
  if (authoritySignature.length !== 64) {
    return fail('MPP authority signature is not 64 bytes — webhook persisted bad data');
  }
  const authorityPubkey = new PublicKey(receipt.authority_pubkey_b58);
  const ed25519Ix = buildEd25519VerifyIx(
    authorityPubkey,
    authoritySignature,
    stripeReceiptHashBytes,
  );

  const policyIdBytes = await sha256Bytes(policyId);
  const [operatorPDA] = deriveOperatorPDA(publicKey);
  const [derivedPolicyPDA] = derivePolicyPDA(operatorPDA, policyIdBytes);
  if (derivedPolicyPDA.toBase58() !== policyPda) {
    return fail(
      `Derived policy PDA ${derivedPolicyPDA.toBase58()} does not match DB record ${policyPda}. Re-anchor the policy.`,
    );
  }

  const verifyMppIx = buildVerifyMppPaymentProofIx(
    publicKey,
    publicKey,
    derivedPolicyPDA,
    proofA,
    proofB,
    proofC,
    publicInputs,
  );

  const tx = new Transaction().add(ed25519Ix).add(verifyMppIx);
  tx.feePayer = publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  // Best-effort pre-flight simulate. Legacy Transaction needs signatures
  // before RPC simulate accepts it; the wallet adapter signs only inside
  // sendTransaction. So we ignore signature-verify failures here — real
  // program errors still surface via sendTransaction below.
  try {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      const errStr = JSON.stringify(sim.value.err);
      const isSigError =
        errStr.includes('SignatureFailure') ||
        errStr.toLowerCase().includes('signature');
      if (!isSigError) {
        const logs = sim.value.logs?.join('\n') ?? '';
        return fail(
          `verify_mpp_payment_proof simulate failed: ${errStr}\n\nProgram logs:\n${logs}`,
        );
      }
    }
  } catch {
    // simulate threw (likely sig verify) — non-blocking
  }

  let txSignature: string;
  try {
    txSignature = await sendTransaction(tx, connection);
    await connection.confirmTransaction(txSignature, 'confirmed');
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Solana tx failed');
  }

  // ---- 5. Replay the endpoint with both credentials ------------------------
  onStatus?.('Unlocking protected service…');
  const credential = Buffer.from(
    JSON.stringify({ challengeId: challenge.id, paymentIntentId }),
  ).toString('base64');
  const [proofRecordPDA] = deriveProofRecordPDA(publicKey, publicInputs[1]);

  const paidRes = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      'x-mpp-credential': credential,
      'x-aperture-proof-record': proofRecordPDA.toBase58(),
    },
  });

  const paymentInfo = {
    txSignature,
    proofRecordPda: proofRecordPDA.toBase58(),
    stripePaymentIntent: paymentIntentId,
    poseidonHash: receipt.poseidon_hash_hex,
    amount: `$${(amountCents / 100).toFixed(2)} ${receipt.currency.toUpperCase()}`,
  };

  if (!paidRes.ok) {
    const body = await paidRes.json().catch(() => ({ error: paidRes.statusText }));
    return {
      success: false,
      data: null,
      error: body.error ?? `Replay failed: HTTP ${paidRes.status}`,
      payment: paymentInfo,
    };
  }

  const responseBody = (await paidRes.json()) as { data: T };
  return {
    success: true,
    data: responseBody.data,
    error: null,
    payment: paymentInfo,
  };
}
