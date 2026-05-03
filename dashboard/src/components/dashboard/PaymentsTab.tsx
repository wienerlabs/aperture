'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { config } from '@/lib/config';
import {
  FileText,
  Loader2,
  AlertTriangle,
  X,
  ShieldCheck,
  ShieldX,
  ExternalLink,
} from 'lucide-react';
import { complianceApi, policyApi, type ProofRecord } from '@/lib/api';
import { truncateAddress } from '@/lib/utils';
import {
  buildVerifyPaymentProofV2Ix,
  deriveOperatorPDA,
  derivePolicyPDA,
  readEffectiveDailySpentLamports,
  sha256Bytes,
} from '@/lib/anchor-instructions';
import { fetchWithX402, type X402Result } from '@/lib/x402-client';
import {
  completeMppFlow,
  fetchMppChallenge,
  fetchMppPublicConfig,
  getStripeDashboardUrl,
  type MppChallenge,
  type MppFlowResult,
  type MppPublicConfig,
} from '@/lib/mpp-client';
import { loadStripe, type Stripe, type StripeElements, type StripeCardElement } from '@stripe/stripe-js';
import { useApertureWalletModal } from '@/components/shared/WalletModal';
import { useTxModal } from '@/components/providers/TxModalProvider';
import {
  makeFromParticipant,
  makeToParticipant,
} from '@/components/shared/TxModal';
import { Receipt, Banknote, ShieldHalf, Wallet, Sparkles, Zap } from 'lucide-react';
import { PaymentStatsRow } from './payments/PaymentStatsRow';
import { PaymentMethodCard } from './payments/PaymentMethodCard';
import { PaymentResultPanel } from './payments/PaymentResultPanel';
import { ProofTable } from './payments/ProofTable';
import { CollapsibleSection } from './payments/CollapsibleSection';
import { CompressionSavingsCard } from './payments/CompressionSavingsCard';
import type { EligibilityState } from './payments/EligibilityChecklist';

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// SPL Token-2022 program — pinned at the protocol level, not a deployment
// concern, so it stays as a literal here. Every Aperture-issued mint with a
// transfer-hook attached lives under this program.
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

export function PaymentsTab() {
  const operatorId = useOperatorId();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible: openWalletModal } = useApertureWalletModal();
  const tx = useTxModal();

  const [proofs, setProofs] = useState<readonly ProofRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [x402Loading, setX402Loading] = useState(false);
  const [showHookTest, setShowHookTest] = useState(false);
  const [showCostSavings, setShowCostSavings] = useState(false);
  const [x402Result, setX402Result] = useState<X402Result<unknown> | null>(null);
  const [hookTestingWithout, setHookTestingWithout] = useState(false);
  const [hookTestingWith, setHookTestingWith] = useState(false);
  const [hookResult, setHookResult] = useState<{
    readonly type: 'success' | 'rejected';
    readonly message: string;
    readonly txSignature?: string;
  } | null>(null);

  // ---- MPP B-flow state ----
  const [mppPublicConfig, setMppPublicConfig] = useState<MppPublicConfig | null>(null);
  const [mppLoading, setMppLoading] = useState(false);
  const [mppStatus, setMppStatus] = useState<string | null>(null);
  const [mppError, setMppError] = useState<string | null>(null);
  const [mppChallenge, setMppChallenge] = useState<MppChallenge | null>(null);
  const [mppEndpoint, setMppEndpoint] = useState<string | null>(null);
  const [mppResult, setMppResult] = useState<MppFlowResult<unknown> | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const stripeElementsRef = useRef<StripeElements | null>(null);
  const cardElementRef = useRef<StripeCardElement | null>(null);
  const cardMountRef = useRef<HTMLDivElement | null>(null);
  const [cardReady, setCardReady] = useState(false);

  const fetchProofs = useCallback(async () => {
    if (!operatorId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await complianceApi.listProofsByOperator(operatorId);
      setProofs(response.data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch payment proofs';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  useEffect(() => {
    fetchProofs();
  }, [fetchProofs]);

  // Elapsed timer -- runs only while the x402 flow is in flight.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTimerActive = x402Loading;
  useEffect(() => {
    if (isTimerActive) {
      setElapsedSec(0);
      timerRef.current = setInterval(() => setElapsedSec(s => s + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isTimerActive]);

  async function testTransferHook(withProof: boolean) {
    if (!publicKey || !sendTransaction) return;
    const aUsdcMint = config.tokens.aUSDC;
    if (!aUsdcMint) {
      setError('aUSDC mint address not configured. Set NEXT_PUBLIC_AUSDC_MINT in .env');
      return;
    }

    if (withProof) { setHookTestingWith(true); } else { setHookTestingWithout(true); }
    setHookResult(null);
    setError(null);

    try {
      const mintPubkey = new PublicKey(aUsdcMint);
      const VERIFIER_PROGRAM = new PublicKey(config.programs.verifier);
      // Test fixture: a fixed 1.000000 aUSDC self-transfer. The amount lives
      // in the proof's public outputs and the transfer-hook checks it against
      // the actual transfer instruction, so changing it here would surface a
      // hook rejection rather than silently corrupt anything.
      const amount = 1_000_000; // 1 aUSDC at 6 decimals

      const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
      const senderAta = getAssociatedTokenAddressSync(
        mintPubkey,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      if (!withProof) {
        // Check if wallet already has ComplianceStatus
        const [compliancePDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('compliance'), publicKey.toBuffer()],
          VERIFIER_PROGRAM
        );
        const complianceInfo = await connection.getAccountInfo(compliancePDA);

        if (complianceInfo) {
          setHookResult({
            type: 'success',
            message:
              'This wallet already has a verified ComplianceStatus PDA, so a Token-2022 transfer would pass the hook. To observe a rejection, connect a wallet that has never anchored a proof and re-run the test.',
          });
          setHookTestingWithout(false);
          return;
        }
      }

      if (withProof) {
        // Step 1: Generate a real proof first via prover service
        const policiesRes = await policyApi.list(publicKey.toBase58());
        const policies = policiesRes.data;
        const candidates = policies.filter(
          (p) => p.is_active && p.onchain_status === 'registered' && p.onchain_pda,
        );
        const policy =
          candidates.find((p) => p.token_whitelist.includes(aUsdcMint)) ??
          candidates[0];
        if (!policy) {
          setError('No on-chain-registered policy. Create + anchor one first.');
          setHookTestingWith(false);
          return;
        }
        if (!policy.token_whitelist.includes(aUsdcMint)) {
          setError(`Active policy "${policy.name}" does not whitelist aUSDC. Edit it to enable aUSDC and re-anchor.`);
          setHookTestingWith(false);
          return;
        }

        const compiled = await policyApi.compile(policy.id);
        if (!compiled.data) {
          setError('Failed to compile policy.');
          setHookTestingWith(false);
          return;
        }

        // Generate proof
        // The hook test does a self-transfer (sender == recipient) so we
        // can prove the hook gates a real Token-2022 transfer end-to-end
        // without needing a separate counterparty wallet on devnet.
        const dailySpentBeforeLamports = (
          await readEffectiveDailySpentLamports(connection, publicKey)
        ).toString();
        const proveRes = await fetch(`${config.proverServiceUrl}/prove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            policy_id: compiled.data.policy_id,
            operator_id: compiled.data.operator_id,
            max_daily_spend_lamports: parseInt(compiled.data.max_daily_spend_lamports, 10),
            max_per_transaction_lamports: parseInt(compiled.data.max_per_transaction_lamports, 10),
            allowed_endpoint_categories: compiled.data.allowed_endpoint_categories,
            blocked_addresses: compiled.data.blocked_addresses,
            token_whitelist: compiled.data.token_whitelist,
            time_restrictions: compiled.data.time_restrictions ?? [],
            payment_amount_lamports: amount,
            payment_token_mint: aUsdcMint,
            payment_recipient: publicKey.toBase58(),
            payment_endpoint_category: compiled.data.allowed_endpoint_categories[0] ?? 'compute',
            daily_spent_before_lamports: dailySpentBeforeLamports,
            current_unix_timestamp: Math.floor(Date.now() / 1000),
          }),
        });

        if (!proveRes.ok) {
          const errBody = await proveRes.json().catch(() => ({ error: 'Prover error' }));
          throw new Error(errBody.error ?? `Prover returned ${proveRes.status}`);
        }

        const proofData = await proveRes.json();

        // Step 2: Write proof on-chain via the Circom+groth16-solana verifier
        const proofA = Uint8Array.from(Buffer.from(proofData.groth16.proof_a, 'base64'));
        const proofB = Uint8Array.from(Buffer.from(proofData.groth16.proof_b, 'base64'));
        const proofC = Uint8Array.from(Buffer.from(proofData.groth16.proof_c, 'base64'));
        const publicInputs = proofData.groth16.public_inputs.map(
          (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'))
        );

        const [operatorPDA] = deriveOperatorPDA(publicKey);
        const hookPolicyIdBytes = await sha256Bytes(policy.id);
        const [hookPolicyPDA] = derivePolicyPDA(operatorPDA, hookPolicyIdBytes);

        const verifyIx = buildVerifyPaymentProofV2Ix(
          publicKey,
          publicKey,
          hookPolicyPDA,
          proofA,
          proofB,
          proofC,
          publicInputs
        );

        const proofTx = new Transaction().add(verifyIx);
        proofTx.feePayer = publicKey;
        const { blockhash: bh1 } = await connection.getLatestBlockhash();
        proofTx.recentBlockhash = bh1;
        // Pre-flight simulate so the user gets a clear program-log message
        // instead of the wallet adapter's opaque "Unexpected error" wrapper.
        const proofSim = await connection.simulateTransaction(proofTx);
        if (proofSim.value.err) {
          const logs = proofSim.value.logs?.join('\n') ?? '';
          throw new Error(
            `verify_payment_proof_v2 simulate failed: ${JSON.stringify(proofSim.value.err)}\n\nProgram logs:\n${logs}`,
          );
        }
        const proofSig = await sendTransaction(proofTx, connection);
        await connection.confirmTransaction(proofSig, 'confirmed');
      }

      // Step 3: Attempt real Token-2022 transfer (will trigger the transfer hook)
      const { createTransferCheckedWithTransferHookInstruction } = await import('@solana/spl-token');

      const transferIx = await createTransferCheckedWithTransferHookInstruction(
        connection,
        senderAta,
        mintPubkey,
        senderAta, // self-transfer for testing
        publicKey,
        BigInt(amount),
        6, // decimals
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction().add(transferIx);
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      // Pre-flight simulate so transfer-hook rejections surface their real
      // program log (e.g. recipient/amount/mint mismatch, no pending
      // proof, daily-spent overflow) instead of "Unexpected error".
      const transferSim = await connection.simulateTransaction(tx);
      if (transferSim.value.err) {
        const logs = transferSim.value.logs?.join('\n') ?? '';
        throw new Error(
          `transfer simulate failed: ${JSON.stringify(transferSim.value.err)}\n\nProgram logs:\n${logs}`,
        );
      }
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      if (withProof) {
        setHookResult({
          type: 'success',
          message: 'Transfer succeeded! Proof was verified by the transfer hook.',
          txSignature: sig,
        });
      } else {
        // If we got here without a proof, the hook may not be enforcing yet
        setHookResult({
          type: 'success',
          message: 'Transfer submitted. Check Solana explorer for hook validation details.',
          txSignature: sig,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transfer hook test failed';
      if (!withProof && (message.includes('ProofNotVerified') || message.includes('NoProofRecord') || message.includes('custom program error'))) {
        setHookResult({
          type: 'rejected',
          message: 'Transfer correctly rejected! No valid proof found for this transfer.',
        });
      } else if (!withProof) {
        setHookResult({
          type: 'rejected',
          message: `Transfer rejected: ${message}`,
        });
      } else {
        setError(message);
      }
    } finally {
      setHookTestingWithout(false);
      setHookTestingWith(false);
    }
  }

  async function accessProtectedReport() {
    if (!operatorId) return;
    if (!publicKey || !sendTransaction) {
      openWalletModal(true);
      return;
    }
    setX402Loading(true);
    setX402Result(null);
    setError(null);

    // 1 USDC by default for the protected report — matches the
    // compliance-api's PUBLISHER_AMOUNT_LAMPORTS env. We seed the modal with
    // this expected shape; the real txSignature lands when the x402 client
    // returns.
    const tokenSymbol = 'USDC';
    const expectedLamports = 1_000_000n;
    const fromParticipant = makeFromParticipant({
      walletPubkey: publicKey.toBase58(),
      tokenSymbol,
      amountLamports: expectedLamports,
    });
    const toParticipant = makeToParticipant({
      treasuryPubkey: config.publisherWallet,
      tokenSymbol,
      amountLamports: expectedLamports,
      resourceLabel: 'x402 Compliance Report',
    });

    tx.show({
      status: 'pending',
      from: fromParticipant,
      to: toParticipant,
      footnote: 'Generating Groth16 proof with snarkjs…',
    });

    try {
      const endpoint = `${config.complianceApiUrl}/api/v1/compliance/protected-report?operator_id=${operatorId}`;
      const result = await fetchWithX402(
        endpoint,
        connection,
        publicKey,
        sendTransaction,
      );
      setX402Result(result);
      if (!result.success) {
        setError(result.error ?? 'x402 payment failed');
        tx.update({
          status: 'error',
          errorMessage: result.error ?? 'x402 payment failed',
        });
      } else {
        tx.update({
          status: 'success',
          txSignature: result.payment?.txSignature ?? null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'x402 request failed';
      setError(message);
      setX402Result({ success: false, data: null, error: message, payment: null });
      tx.update({ status: 'error', errorMessage: message });
    } finally {
      setX402Loading(false);
    }
  }

  // ---- MPP: load Stripe publishable key + authority pubkey ----
  useEffect(() => {
    let cancelled = false;
    fetchMppPublicConfig()
      .then((cfg) => {
        if (!cancelled) setMppPublicConfig(cfg);
      })
      .catch(() => {
        if (!cancelled) setMppPublicConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- MPP: kick off the 402 challenge + mount Stripe Elements card input ----
  async function startMppFlow(): Promise<void> {
    if (!operatorId) return;
    if (!publicKey || !sendTransaction) {
      openWalletModal(true);
      return;
    }
    if (!mppPublicConfig?.stripe.publishableKey) {
      setMppError(
        'Stripe publishable key not configured on the compliance-api. Set STRIPE_PUBLISHABLE_KEY and restart.',
      );
      return;
    }

    setMppLoading(true);
    setMppError(null);
    setMppResult(null);
    setMppStatus('Requesting Stripe PaymentIntent…');
    try {
      const { endpoint, challenge } = await fetchMppChallenge(operatorId);
      setMppEndpoint(endpoint);
      setMppChallenge(challenge);

      if (!stripeRef.current) {
        stripeRef.current = await loadStripe(mppPublicConfig.stripe.publishableKey);
      }
      if (!stripeRef.current) throw new Error('Stripe.js failed to load');

      const elements = stripeRef.current.elements({ clientSecret: challenge.stripe.clientSecret });
      stripeElementsRef.current = elements;
      // Wait one render so the mount div exists, then create + mount the card element.
      setMppStatus('Enter card details and confirm payment.');
      // Defer the mount so React renders the form first
      setTimeout(() => {
        if (!cardMountRef.current || !stripeElementsRef.current) return;
        const card = stripeElementsRef.current.create('card', {
          style: {
            base: {
              color: '#fef3c7',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: '14px',
              '::placeholder': { color: 'rgba(254, 243, 199, 0.4)' },
            },
            invalid: { color: '#f87171' },
          },
        });
        card.mount(cardMountRef.current);
        card.on('ready', () => setCardReady(true));
        cardElementRef.current = card;
      }, 50);
    } catch (err) {
      setMppError(err instanceof Error ? err.message : 'Failed to start MPP flow');
      setMppStatus(null);
    } finally {
      setMppLoading(false);
    }
  }

  async function confirmMppCardAndComplete(): Promise<void> {
    if (!operatorId || !publicKey || !sendTransaction) return;
    if (!stripeRef.current || !mppChallenge || !mppEndpoint || !cardElementRef.current) {
      setMppError('MPP flow not initialized');
      return;
    }
    setMppLoading(true);
    setMppError(null);
    setMppResult(null);
    setMppStatus('Confirming card with Stripe…');
    try {
      const { error: stripeError, paymentIntent } =
        await stripeRef.current.confirmCardPayment(mppChallenge.stripe.clientSecret, {
          payment_method: { card: cardElementRef.current },
        });
      if (stripeError) {
        setMppError(stripeError.message ?? 'Stripe declined the card');
        setMppStatus(null);
        return;
      }
      if (!paymentIntent || paymentIntent.status !== 'succeeded') {
        setMppError(`Stripe PaymentIntent status: ${paymentIntent?.status ?? 'unknown'}`);
        setMppStatus(null);
        return;
      }

      const result = await completeMppFlow<unknown>({
        connection,
        publicKey,
        sendTransaction,
        operatorId,
        endpoint: mppEndpoint,
        challenge: mppChallenge,
        paymentIntentId: paymentIntent.id,
        onStatus: (msg) => setMppStatus(msg),
      });
      setMppResult(result);
      if (!result.success) {
        setMppError(result.error ?? 'MPP flow failed');
      } else {
        setMppStatus(null);
        // Tear down the card element so a re-run starts a new challenge
        cardElementRef.current?.destroy();
        cardElementRef.current = null;
        stripeElementsRef.current = null;
        setMppChallenge(null);
        setCardReady(false);
        // Refresh the proof table so the new MPP ProofRecord shows up.
        fetchProofs();
      }
    } catch (err) {
      setMppError(err instanceof Error ? err.message : 'MPP completion failed');
      setMppStatus(null);
    } finally {
      setMppLoading(false);
    }
  }


  if (!operatorId) {
    return (
      <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
          <Wallet className="h-6 w-6" />
        </span>
        <h2 className="font-display text-[24px] tracking-[-0.012em] text-black">
          Connect a wallet to view payments
        </h2>
        <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
          Aperture surfaces zero-knowledge proof records, x402 paywalled flows, and Stripe MPP
          settlements per operator. Sign in or connect a wallet to continue.
        </p>
      </div>
    );
  }

  // ---- Eligibility checklists (computed inline for both cards) ----
  const x402Checks: readonly { label: string; state: EligibilityState; hint?: string }[] = [
    {
      label: publicKey ? 'Wallet connected' : 'Connect wallet',
      state: publicKey ? 'ready' : 'blocked',
    },
    {
      label: x402Loading ? 'Generating proof' : 'Prover ready',
      state: x402Loading ? 'pending' : 'ready',
    },
    { label: 'USDC treasury', state: 'ready', hint: 'Treasury wallet pinned in config' },
  ];

  const mppChecks: readonly { label: string; state: EligibilityState; hint?: string }[] = [
    {
      label: publicKey ? 'Wallet connected' : 'Connect wallet',
      state: publicKey ? 'ready' : 'blocked',
    },
    {
      label: mppPublicConfig?.stripe.publishableKey ? 'Stripe configured' : 'Stripe key missing',
      state: mppPublicConfig?.stripe.publishableKey ? 'ready' : 'blocked',
      hint: 'Set STRIPE_PUBLISHABLE_KEY on the compliance-api',
    },
    {
      label: mppLoading ? 'Charging card' : 'Idle',
      state: mppLoading ? 'pending' : 'ready',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Hero ribbon */}
      <section
        className="relative overflow-hidden rounded-[24px] border border-black/8 bg-white p-6 sm:p-8"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 50% 80% at 95% 10%, rgba(248,179,0,0.18) 0%, rgba(248,179,0,0) 65%)',
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-aperture/15 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark w-fit">
              <Receipt className="h-3 w-3" />
              Payments &amp; Proof Records
            </span>
            <h1 className="font-display text-[36px] sm:text-[44px] leading-[1.04] tracking-[-0.012em] text-black">
              Atomic verify + transfer
            </h1>
            <p className="text-[14px] text-black/55 tracking-tighter max-w-2xl">
              Run an x402 paywalled flow or MPP Stripe settlement, then watch the proof land
              on Devnet. Every transfer is gated by the verifier program before settlement.
            </p>
          </div>
        </div>
      </section>

      {/* Stats row */}
      <PaymentStatsRow proofs={proofs} />

      {/* Top-level error (kept above the cards so it's hard to miss) */}
      {error && (
        <div className="ap-card p-4 flex items-start gap-3" style={{ borderColor: '#fca5a5' }}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-600" />
          <pre className="text-[12px] whitespace-pre-wrap break-words flex-1 font-mono text-red-700/85">
            {error}
          </pre>
          <button
            onClick={() => setError(null)}
            className="ml-auto flex-shrink-0 text-black/45 hover:text-black"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="ap-card p-12 flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-aperture animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && proofs.length === 0 && !error && (
        <div className="ap-card p-10 flex flex-col items-center text-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
            <FileText className="h-6 w-6" />
          </span>
          <h3 className="font-display text-[22px] tracking-[-0.005em] text-black">
            No payment proofs yet
          </h3>
          <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
            Run the x402 or MPP flow below to generate your first ZK proof. The verifier
            program records every settlement on Solana Devnet.
          </p>
        </div>
      )}

      {/* Two-column payment methods */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* x402 — Coinbase / USDC rails */}
        <PaymentMethodCard
          title="x402 Protected Report"
          subtitle="HTTP 402 + atomic Groth16 verify + SPL transfer (1 USDC)."
          badge="USDC · Solana"
          icon={Zap}
          variant="x402"
          accent="orange"
          checklist={x402Checks}
          protocols={['coinbase', 'solana', 'circom']}
          action={
            <button
              onClick={accessProtectedReport}
              disabled={x402Loading || !publicKey || !sendTransaction}
              className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {x402Loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {x402Loading ? 'Generating proof + paying…' : 'Access Protected Report'}
            </button>
          }
        >
          {x402Loading && (
            <div className="flex items-center gap-3 rounded-[14px] border border-aperture/30 bg-aperture/5 px-3 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin shrink-0 text-aperture-dark" />
              <div className="flex-1">
                <p className="text-[13px] text-black tracking-tighter">
                  Generating ZK proof and processing USDC payment…
                </p>
                <p className="text-[11px] text-black/55 tracking-tighter mt-0.5">
                  Witness + Groth16 prove may take several minutes on first run.
                </p>
              </div>
              <span className="font-mono text-[13px] text-aperture-dark">
                {formatElapsed(elapsedSec)}
              </span>
            </div>
          )}

          {x402Result?.payment && (
            <PaymentResultPanel
              status="success"
              title="Payment verified on-chain"
              details={[
                {
                  label: 'Transaction',
                  value: truncateAddress(x402Result.payment.txSignature, 8),
                  href: config.txExplorerUrl(x402Result.payment.txSignature),
                  mono: true,
                },
                { label: 'Amount', value: x402Result.payment.amount, mono: true },
                {
                  label: 'Payer',
                  value: truncateAddress(x402Result.payment.payer, 6),
                  mono: true,
                },
                {
                  label: 'ZK Proof Hash',
                  value: x402Result.payment.zkProofHash
                    ? truncateAddress(x402Result.payment.zkProofHash, 10)
                    : '—',
                  mono: true,
                },
                {
                  label: 'Endpoint',
                  value: '/compliance/protected-report',
                  mono: true,
                  fullWidth: true,
                },
              ]}
            >
              {x402Result.success && x402Result.data ? (
                <div className="rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-2.5">
                  <span className="text-[11px] uppercase tracking-[0.08em] text-black/55 block mb-1">
                    Compliance Report
                  </span>
                  <pre className="text-[11px] text-black font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(x402Result.data, null, 2)}
                  </pre>
                </div>
              ) : null}
            </PaymentResultPanel>
          )}

          {x402Result && !x402Result.success && x402Result.error && (
            <PaymentResultPanel
              status="error"
              title="x402 flow failed"
              errorMessage={x402Result.error}
            />
          )}
        </PaymentMethodCard>

        {/* MPP — Stripe + Solana */}
        <PaymentMethodCard
          title="MPP Protected Service"
          subtitle="Stripe charge → ed25519 receipt → on-chain proof ($1.00)."
          badge="Stripe · Devnet"
          icon={Banknote}
          variant="mpp"
          accent="navy"
          checklist={mppChecks}
          protocols={['stripe', 'solana', 'circom']}
          action={
            !mppChallenge ? (
              <button
                onClick={startMppFlow}
                disabled={
                  mppLoading ||
                  !publicKey ||
                  !sendTransaction ||
                  !mppPublicConfig?.stripe.publishableKey
                }
                className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {mppLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                {mppLoading ? 'Starting…' : 'Access MPP Service'}
              </button>
            ) : (
              <span className="text-[12px] text-black/55 tracking-tighter">
                Complete the card form above to settle.
              </span>
            )
          }
        >
          {!mppPublicConfig?.stripe.publishableKey && (
            <div className="rounded-[14px] border border-aperture/25 bg-aperture/5 px-3 py-2.5 text-[12px] text-black/65 tracking-tighter">
              Stripe publishable key not configured on the compliance-api. Set{' '}
              <code className="rounded bg-black/5 px-1 text-aperture-dark font-mono">
                STRIPE_PUBLISHABLE_KEY
              </code>{' '}
              and restart to enable.
            </div>
          )}

          {mppChallenge && (
            <div className="rounded-[16px] border border-black/8 bg-[rgba(248,179,0,0.03)] p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-black tracking-tighter">
                  Stripe PaymentIntent: ${mppChallenge.request.amount}{' '}
                  {mppChallenge.request.currency.toUpperCase()}
                </span>
                <span className="text-[11px] font-mono text-black/55">
                  {truncateAddress(mppChallenge.stripe.paymentIntentId, 6)}
                </span>
              </div>
              <p className="text-[11px] text-black/55 tracking-tighter mb-3">
                Test mode: use{' '}
                <code className="rounded bg-black/5 px-1 text-aperture-dark font-mono">
                  4242 4242 4242 4242
                </code>
                , any future expiry, any CVC, any ZIP.
              </p>
              <div
                ref={cardMountRef}
                className="rounded-[10px] border border-black/15 bg-white p-3 min-h-[42px]"
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={confirmMppCardAndComplete}
                  disabled={mppLoading || !cardReady}
                  className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {mppLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {mppLoading ? 'Processing…' : `Pay $${mppChallenge.request.amount}`}
                </button>
                <button
                  onClick={() => {
                    cardElementRef.current?.destroy();
                    cardElementRef.current = null;
                    stripeElementsRef.current = null;
                    setMppChallenge(null);
                    setMppEndpoint(null);
                    setMppStatus(null);
                    setCardReady(false);
                  }}
                  disabled={mppLoading}
                  className="ap-btn-ghost-light disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mppStatus && (
            <div className="flex items-center gap-3 rounded-[14px] border border-aperture/25 bg-aperture/5 px-3 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin shrink-0 text-aperture-dark" />
              <p className="text-[12px] text-black tracking-tighter">{mppStatus}</p>
            </div>
          )}

          {mppError && (
            <div className="flex items-start gap-3 rounded-[14px] border border-red-500/30 bg-red-500/5 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
              <pre className="text-[11px] whitespace-pre-wrap break-words flex-1 font-mono text-red-700/85">
                {mppError}
              </pre>
              <button
                onClick={() => setMppError(null)}
                className="text-black/45 hover:text-black"
                aria-label="Dismiss MPP error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {mppResult?.payment && (
            <PaymentResultPanel
              status="success"
              title="Stripe charged + MPP proof verified on-chain"
              details={[
                {
                  label: 'Stripe PI',
                  value: truncateAddress(mppResult.payment.stripePaymentIntent, 6),
                  href: getStripeDashboardUrl(
                    mppResult.payment.stripePaymentIntent,
                    mppPublicConfig?.stripe.isTestMode ?? true,
                  ),
                  mono: true,
                },
                { label: 'Amount', value: mppResult.payment.amount, mono: true },
                {
                  label: 'Solana Tx',
                  value: truncateAddress(mppResult.payment.txSignature, 8),
                  href: config.txExplorerUrl(mppResult.payment.txSignature),
                  mono: true,
                },
                {
                  label: 'ProofRecord PDA',
                  value: truncateAddress(mppResult.payment.proofRecordPda, 8),
                  href: config.explorerUrl(mppResult.payment.proofRecordPda),
                  mono: true,
                },
                {
                  label: 'Poseidon Receipt Hash',
                  value: mppResult.payment.poseidonHash,
                  mono: true,
                  fullWidth: true,
                },
              ]}
            >
              {mppResult.success && mppResult.data ? (
                <div className="rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-2.5">
                  <span className="text-[11px] uppercase tracking-[0.08em] text-black/55 block mb-1">
                    Unlocked MPP Service Response
                  </span>
                  <pre className="text-[11px] text-black font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {JSON.stringify(mppResult.data, null, 2)}
                  </pre>
                </div>
              ) : null}
            </PaymentResultPanel>
          )}
        </PaymentMethodCard>
      </section>

      {/* Verified Proof Ledger */}
      {!loading && proofs.length > 0 && <ProofTable proofs={proofs} />}

      {/* Transfer Hook Test (collapsible, aUSDC-only) */}
      {config.tokens.aUSDC && (
        <CollapsibleSection
          icon={ShieldHalf}
          title="Transfer Hook Test"
          subtitle="Token-2022 compliance enforcement on the legacy aUSDC mint"
          open={showHookTest}
          onToggle={() => setShowHookTest(!showHookTest)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-[12px] text-black/65 tracking-tighter">
              The hook rejects any transfer without an unconsumed proof. Use the buttons
              below to confirm the hook&apos;s reject-by-default behaviour and the
              proof-passes-through path.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => testTransferHook(false)}
                disabled={hookTestingWithout || hookTestingWith || !publicKey}
                className="inline-flex items-center gap-2 rounded-pill border border-red-500/30 bg-red-500/8 px-4 py-2 text-[13px] font-medium tracking-tighter text-red-700 hover:bg-red-500/12 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {hookTestingWithout ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldX className="h-4 w-4" />
                )}
                Transfer without proof
              </button>
              <button
                onClick={() => testTransferHook(true)}
                disabled={hookTestingWithout || hookTestingWith || !publicKey}
                className="inline-flex items-center gap-2 rounded-pill border border-green-500/30 bg-green-500/8 px-4 py-2 text-[13px] font-medium tracking-tighter text-green-700 hover:bg-green-500/12 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {hookTestingWith ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Transfer with proof
              </button>
            </div>

            {hookResult && (
              <div
                className={`rounded-[14px] border px-3 py-2.5 ${
                  hookResult.type === 'success'
                    ? 'border-green-500/25 bg-green-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                }`}
              >
                <p
                  className={`text-[12px] font-mono ${
                    hookResult.type === 'success' ? 'text-green-700' : 'text-red-700'
                  }`}
                >
                  {hookResult.message}
                </p>
                {hookResult.txSignature && (
                  <a
                    href={config.txExplorerUrl(hookResult.txSignature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-[11px] text-aperture-dark hover:text-black"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View on Solana Explorer
                  </a>
                )}
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* ZK Compression Cost Savings (collapsible) */}
      {proofs.length > 0 && (
        <CollapsibleSection
          icon={Sparkles}
          title="ZK Compression Cost Savings"
          subtitle={`Light Protocol · estimated over ${proofs.length} historical proof${
            proofs.length === 1 ? '' : 's'
          }`}
          open={showCostSavings}
          onToggle={() => setShowCostSavings(!showCostSavings)}
        >
          <CompressionSavingsCard totalProofs={proofs.length} />
        </CollapsibleSection>
      )}
    </div>
  );
}
