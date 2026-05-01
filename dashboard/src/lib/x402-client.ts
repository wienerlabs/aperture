/**
 * x402 payment client for the dashboard.
 *
 * Drives the full production flow that mirrors the agent-service runX402Flow:
 *   1. GET endpoint → expect HTTP 402 with paymentRequirement
 *   2. Load operator's active, on-chain-anchored policy (policy-service)
 *   3. Read on-chain OperatorState for the canonical daily_spent_before
 *   4. POST /prove with the actual recipient/amount/mint and the live
 *      Solana clock timestamp
 *   5. Build a single tx with verify_payment_proof_v2 + Token-2022
 *      transferCheckedWithTransferHook — the transfer-hook intercepts and
 *      CPIs record_payment to atomically advance daily_spent
 *   6. Replay the endpoint with x-402-payment header to unlock the resource
 *
 * No synthetic policy IDs, no in-memory daily_spent, no plain SPL Token
 * fallback. Broken pre-conditions (no anchored policy, vUSDC mint mismatch,
 * unhealthy prover) surface as explicit X402Result.error strings instead of
 * silently downgrading to a non-enforcing transfer.
 */
import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { config } from './config';
import { policyApi } from './api';
import {
  buildVerifyPaymentProofV2WithTransferIx,
  deriveOperatorPDA,
  derivePolicyPDA,
  readEffectiveDailySpentLamports,
  sha256Bytes,
} from './anchor-instructions';

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

function fail<T>(error: string): X402Result<T> {
  console.error('[x402] fail:', error);
  return { success: false, data: null, payment: null, error };
}

export async function fetchWithX402<T>(
  endpoint: string,
  connection: Connection,
  publicKey: PublicKey,
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>,
): Promise<X402Result<T>> {
  console.log('[x402] fetchWithX402 invoked', { endpoint, publicKey: publicKey.toBase58() });
  // ---- 1. Initial 402 challenge --------------------------------------------
  const initialRes = await fetch(endpoint, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (initialRes.ok) {
    const body = await initialRes.json();
    return { success: true, data: body.data, payment: null, error: null };
  }
  if (initialRes.status !== 402) {
    const body = await initialRes.json().catch(() => ({ error: initialRes.statusText }));
    return fail<T>(body.error ?? `HTTP ${initialRes.status}`);
  }
  const paymentBody = await initialRes.json();
  const requirement: X402PaymentRequirement | undefined = paymentBody.paymentRequirement;
  if (!requirement) {
    return fail<T>('Invalid 402 response: no paymentRequirement');
  }

  // ---- 2. Production-flow guards -------------------------------------------
  // x402 supports any SPL token (USDC, USDT, aUSDC, …) the operator's
  // policy whitelists. Compliance is enforced by the atomic Anchor ix
  // verify_payment_proof_v2_with_transfer (ZK proof + recipient/mint/
  // amount byte-binding + daily_spent ceiling), so the dashboard signs
  // whatever the server's 402 challenge advertises as long as it is on
  // the active policy's whitelist.
  const paymentMint = requirement.token;
  const amountLamports = parseInt(requirement.amount, 10);
  if (!Number.isFinite(amountLamports) || amountLamports <= 0) {
    return fail<T>(`Invalid paymentRequirement.amount=${requirement.amount}`);
  }

  // ---- 3. Active anchored policy whose whitelist includes the mint --------
  const operatorId = publicKey.toBase58();
  const policiesRes = await policyApi.list(operatorId);
  const policies = policiesRes.data;
  const candidates = policies.filter(
    (p) => p.is_active && p.onchain_status === 'registered' && p.onchain_pda,
  );
  const policy =
    candidates.find((p) => p.token_whitelist.includes(paymentMint)) ?? candidates[0];
  if (!policy) {
    return fail<T>(
      'No on-chain-registered policy for this operator. Create + anchor a policy from the Policies tab before paying.',
    );
  }
  if (!policy.token_whitelist.includes(paymentMint)) {
    return fail<T>(
      `Active policy "${policy.name}" does not whitelist ${paymentMint}. Edit the policy to enable this token and re-anchor it on-chain.`,
    );
  }
  const compiledRes = await policyApi.compile(policy.id);
  if (!compiledRes.data) {
    return fail<T>('Policy compile endpoint returned no data');
  }
  const compiled = compiledRes.data;

  if (!compiled.allowed_endpoint_categories.includes('x402')) {
    return fail<T>('Active policy does not allow the "x402" category — edit the policy or anchor a different one.');
  }
  const maxPerTxLamports =
    parseInt(compiled.max_per_transaction_lamports, 10) || 0;
  if (amountLamports > maxPerTxLamports) {
    return fail<T>(
      `paymentRequirement.amount=${amountLamports} exceeds policy max_per_transaction=${maxPerTxLamports}.`,
    );
  }

  // ---- 4. On-chain daily_spent + timestamp ---------------------------------
  const dailySpentBefore = await readEffectiveDailySpentLamports(connection, publicKey);
  const nowUnix = Math.floor(Date.now() / 1000);

  // ---- 5. Generate ZK proof against the real transfer parameters -----------
  if (!config.proverServiceUrl) {
    return fail<T>('NEXT_PUBLIC_PROVER_SERVICE_URL not configured — cannot generate the compliance proof.');
  }
  console.log('[x402] starting prover request', { policyId: policy.id, amountLamports });
  const proveRes = await fetch(`${config.proverServiceUrl}/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy_id: compiled.policy_id,
      operator_id: compiled.operator_id,
      max_daily_spend_lamports: parseInt(compiled.max_daily_spend_lamports, 10),
      max_per_transaction_lamports: maxPerTxLamports,
      allowed_endpoint_categories: compiled.allowed_endpoint_categories,
      blocked_addresses: compiled.blocked_addresses,
      token_whitelist: compiled.token_whitelist,
      time_restrictions: compiled.time_restrictions ?? [],
      payment_amount_lamports: amountLamports,
      payment_token_mint: paymentMint,
      payment_recipient: requirement.recipient,
      payment_endpoint_category: 'x402',
      daily_spent_before_lamports: dailySpentBefore.toString(),
      current_unix_timestamp: nowUnix,
    }),
  });
  if (!proveRes.ok) {
    const errBody = await proveRes.json().catch(() => ({ error: proveRes.statusText }));
    console.error('[x402] prover failed', proveRes.status, errBody);
    return fail<T>(`Prover error: ${errBody.error ?? proveRes.status}`);
  }
  const proofData = await proveRes.json();
  console.log('[x402] prover ok', { isCompliant: proofData.is_compliant });
  if (proofData.is_compliant !== true) {
    return fail<T>('Prover reported is_compliant=false — payment violates the active policy.');
  }

  // ---- 6. Build verify_payment_proof_v2 + Token-2022 transfer in one tx ----
  const proofA = Uint8Array.from(Buffer.from(proofData.groth16.proof_a, 'base64'));
  const proofB = Uint8Array.from(Buffer.from(proofData.groth16.proof_b, 'base64'));
  const proofC = Uint8Array.from(Buffer.from(proofData.groth16.proof_c, 'base64'));
  const publicInputs = proofData.groth16.public_inputs.map(
    (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64')),
  );

  const [operatorPDA] = deriveOperatorPDA(publicKey);
  const policyIdBytes = await sha256Bytes(policy.id);
  const [policyPDA] = derivePolicyPDA(operatorPDA, policyIdBytes);
  if (policy.onchain_pda && policyPDA.toBase58() !== policy.onchain_pda) {
    return fail<T>(
      `Derived policy PDA ${policyPDA.toBase58()} does not match DB record ${policy.onchain_pda}. Re-anchor the policy.`,
    );
  }

  const mintPubkey = new PublicKey(paymentMint);
  const recipientPubkey = new PublicKey(requirement.recipient);

  // Detect token program (SPL Token vs Token-2022) by reading the mint
  // account's program owner. USDC and USDT live under SPL Token; aUSDC
  // lives under Token-2022 with a transfer-hook extension. The atomic
  // verify_payment_proof_v2_with_transfer ix accepts both transparently.
  const mintInfo = await connection.getAccountInfo(mintPubkey, 'confirmed');
  if (!mintInfo) {
    return fail<T>(`Mint ${paymentMint} not found on-chain`);
  }
  const tokenProgramId = mintInfo.owner;
  const isToken1 = tokenProgramId.equals(TOKEN_PROGRAM_ID);
  const isToken2022 = tokenProgramId.equals(TOKEN_2022_PROGRAM_ID);
  if (!isToken1 && !isToken2022) {
    return fail<T>(
      `Mint ${paymentMint} is owned by ${tokenProgramId.toBase58()}, not a known token program`,
    );
  }

  const sourceAta = await getAssociatedTokenAddress(
    mintPubkey,
    publicKey,
    false,
    tokenProgramId,
  );
  const destAta = await getAssociatedTokenAddress(
    mintPubkey,
    recipientPubkey,
    false,
    tokenProgramId,
  );

  // Treasury's ATA must exist before the transfer.
  const destAtaInfo = await connection.getAccountInfo(destAta, 'confirmed');
  if (!destAtaInfo) {
    console.log('[x402] recipient ATA missing, creating it first');
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(
      publicKey,
      destAta,
      recipientPubkey,
      mintPubkey,
      tokenProgramId,
    );
    const ataTx = new Transaction().add(ataIx);
    ataTx.feePayer = publicKey;
    ataTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    try {
      const ataSig = await sendTransaction(ataTx, connection);
      await connection.confirmTransaction(ataSig, 'confirmed');
      console.log('[x402] recipient ATA created', ataSig);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ATA create failed';
      return fail<T>(`Recipient ATA create tx failed: ${message}`);
    }
  }

  // Read mint decimals from the mint account; SPL Token + Token-2022
  // share the same byte offset (44) for the `decimals` u8.
  const mintDecimals = mintInfo.data[44];

  // Single atomic Anchor ix: Groth16 verify + byte-bind + state update +
  // transferChecked CPI. No transfer-hook involvement on this code path,
  // so the tx fits comfortably under the 1232-byte legacy limit.
  const verifyWithTransferIx = buildVerifyPaymentProofV2WithTransferIx({
    operator: publicKey,
    payer: publicKey,
    policyAccount: policyPDA,
    operatorAccount: operatorPDA,
    sourceTokenAccount: sourceAta,
    destinationTokenAccount: destAta,
    mint: mintPubkey,
    tokenProgram: tokenProgramId,
    proofA,
    proofB,
    proofC,
    publicInputs,
    transferAmount: BigInt(amountLamports),
  });
  void mintDecimals; // mint decimals are read by the program from the mint account itself

  const tx = new Transaction().add(verifyWithTransferIx);
  tx.feePayer = publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  // Best-effort pre-flight simulate so on-chain rejections (bad PDA,
  // transfer hook errors, daily-spent ceiling, etc) surface real program
  // logs instead of the wallet adapter's opaque wrapper. simulateTransaction
  // on a legacy Transaction requires the tx to be signed; the wallet
  // adapter signs only inside sendTransaction, so we wrap the call and
  // ignore any signature-verify failure here — the actual error (if any)
  // surfaces in sendTransaction below.
  console.log('[x402] simulating tx');
  try {
    const sim = await connection.simulateTransaction(tx);
    if (sim.value.err) {
      const errStr = JSON.stringify(sim.value.err);
      const isSigError =
        errStr.includes('SignatureFailure') ||
        errStr.includes('signature verification') ||
        errStr.toLowerCase().includes('signature');
      if (!isSigError) {
        const logs = sim.value.logs?.join('\n') ?? '';
        console.error('[x402] simulate failed', sim.value.err, logs);
        return fail<T>(
          `verify_payment_proof_v2 + transfer simulate failed: ${errStr}\n\nProgram logs:\n${logs}`,
        );
      }
      console.log('[x402] simulate skipped (sig verify expected pre-sign)');
    }
  } catch (simErr) {
    console.log(
      '[x402] simulate threw (non-blocking)',
      simErr instanceof Error ? simErr.message : simErr,
    );
  }

  console.log('[x402] sending tx');
  let txSignature: string;
  try {
    txSignature = await sendTransaction(tx, connection);
    await connection.confirmTransaction(txSignature, 'confirmed');
    console.log('[x402] tx confirmed', txSignature);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transaction failed';
    console.error('[x402] tx failed', err);
    return fail<T>(`Solana tx failed: ${message}`);
  }

  // ---- 7. Replay endpoint with payment header ------------------------------
  const proofHeader = Buffer.from(
    JSON.stringify({
      txSignature,
      payer: publicKey.toBase58(),
      zkProofHash: proofData.policy_data_hash_hex ?? proofData.proof_hash,
    }),
  ).toString('base64');
  const paidRes = await fetch(endpoint, {
    headers: { 'Content-Type': 'application/json', 'x-402-payment': proofHeader },
  });

  const paymentInfo = {
    txSignature,
    payer: publicKey.toBase58(),
    amount: `${amountLamports / 10 ** config.tokenDecimals} aUSDC`,
    recipient: requirement.recipient,
    zkProofHash: proofData.policy_data_hash_hex ?? proofData.proof_hash ?? null,
  };

  if (!paidRes.ok) {
    const body = await paidRes.json().catch(() => ({ error: paidRes.statusText }));
    return {
      success: false,
      data: null,
      payment: paymentInfo,
      error: body.error ?? `Payment landed but resource fetch failed: HTTP ${paidRes.status}`,
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
