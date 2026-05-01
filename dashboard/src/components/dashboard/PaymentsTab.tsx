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
  CheckCircle,
  XCircle,
  Copy,
  ShieldCheck,
  ShieldX,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { complianceApi, policyApi, type ProofRecord } from '@/lib/api';
import { truncateAddress, formatDate, formatAmount } from '@/lib/utils';
import {
  buildVerifyPaymentProofV2Ix,
  deriveOperatorPDA,
  derivePolicyPDA,
  readEffectiveDailySpentLamports,
  sha256Bytes,
} from '@/lib/anchor-instructions';
import {
  getProofRecordCostComparison,
  lamportsToSol,
  isLightProtocolConfigured,
} from '@/lib/light-protocol';
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

function getTokenLabel(mint: string): string {
  if (config.tokens.usdc && mint === config.tokens.usdc) return 'USDC';
  if (config.tokens.usdt && mint === config.tokens.usdt) return 'USDT';
  if (config.tokens.aUSDC && mint === config.tokens.aUSDC) return 'aUSDC';
  if (mint.toLowerCase() === 'usd') return 'USD';
  return truncateAddress(mint, 4);
}



export function PaymentsTab() {
  const operatorId = useOperatorId();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible: openWalletModal } = useApertureWalletModal();

  const [proofs, setProofs] = useState<readonly ProofRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  async function copyToClipboard(text: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }

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
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'x402 request failed';
      setError(message);
      // Mirror to x402Result so the failure card renders next to the x402
      // button — operators tend to look there, not at the page-top error.
      setX402Result({ success: false, data: null, error: message, payment: null });
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
      <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
        <FileText className="w-12 h-12 mb-4" />
        <p className="text-lg">Connect your wallet to view payments</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-amber-100">Payments</h2>
          <p className="text-amber-100/40 text-sm mt-1">
            Zero-knowledge proof records for processed payments</p>
        </div>
      </div>

      {/* Transfer Hook Test (collapsible) */}
      {config.tokens.aUSDC && (
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl">
          <button
            onClick={() => setShowHookTest(!showHookTest)}
            className="flex items-center justify-between w-full p-4 text-left"
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-100">Transfer Hook Test</span>
              <span className="text-xs text-amber-100/50">aUSDC compliance enforcement</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-amber-100/40 transition-transform ${showHookTest ? 'rotate-180' : ''}`} />
          </button>
          {showHookTest && <div className="px-4 pb-4 pt-0">

          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => testTransferHook(false)}
              disabled={hookTestingWithout || hookTestingWith || !publicKey}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                bg-red-500/20 text-red-400 border border-red-400/30 hover:bg-red-500/30
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {hookTestingWithout ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldX className="w-4 h-4" />}
              Transfer Without Proof
            </button>
            <button
              onClick={() => testTransferHook(true)}
              disabled={hookTestingWithout || hookTestingWith || !publicKey}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                bg-green-500/20 text-green-400 border border-green-400/30 hover:bg-green-500/30
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {hookTestingWith ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Transfer With Proof
            </button>
          </div>

          {hookResult && (
            <div className={`p-3 rounded-lg text-sm font-mono ${
              hookResult.type === 'success'
                ? 'bg-green-400/10 border border-green-400/20 text-green-400'
                : 'bg-red-400/10 border border-red-400/20 text-red-400'
            }`}>
              <p>{hookResult.message}</p>
              {hookResult.txSignature && (
                <a
                  href={config.txExplorerUrl(hookResult.txSignature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 mt-2 text-xs text-amber-400 hover:text-amber-300"
                >
                  <ExternalLink className="w-3 h-3" />
                  View on Solana Explorer
                </a>
              )}
            </div>
          )}
          </div>}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <pre className="text-xs whitespace-pre-wrap break-words flex-1 font-mono">{error}</pre>
          <button
            onClick={() => setError(null)}
            className="ml-auto flex-shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && proofs.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
          <FileText className="w-12 h-12 mb-4" />
          <p className="text-lg">No payment proofs recorded yet</p>
          <p className="text-sm mt-1">
            Payment proofs will appear here after transactions are processed
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && proofs.length > 0 && (
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-amber-400/10">
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    Payment ID
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    Policy ID
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    Proof Hash
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    Amount Range
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    Token
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    Compliant
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    Verified At
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-medium text-amber-100/40 uppercase tracking-wider">
                    TX
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-400/10">
                {proofs.map((proof) => (
                  <tr
                    key={proof.id}
                    className="hover:bg-amber-400/5 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm font-mono text-amber-100">
                      {truncateAddress(proof.payment_id, 6)}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-amber-100/60">
                      {truncateAddress(proof.policy_id, 6)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            setExpandedHash(
                              expandedHash === proof.id ? null : proof.id
                            )
                          }
                          className="font-mono text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                          title="Click to expand"
                        >
                          {expandedHash === proof.id
                            ? proof.proof_hash
                            : truncateAddress(proof.proof_hash, 8)}
                        </button>
                        <button
                          onClick={() =>
                            copyToClipboard(proof.proof_hash, proof.id)
                          }
                          className="text-amber-100/40 hover:text-amber-400 transition-colors"
                          aria-label="Copy proof hash"
                        >
                          {copiedId === proof.id ? (
                            <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-amber-100">
                      {formatAmount(proof.amount_range_min)} -{' '}
                      {formatAmount(proof.amount_range_max)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 text-xs font-mono">
                        {getTokenLabel(proof.token_mint)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {proof.is_compliant ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 text-xs font-medium w-fit">
                          <CheckCircle className="w-3 h-3" />
                          Yes
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-400/10 text-red-400 text-xs font-medium w-fit">
                          <XCircle className="w-3 h-3" />
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-amber-100/60">
                      {formatDate(proof.verified_at)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {proof.tx_signature ? (
                        <a
                          href={config.txExplorerUrl(proof.tx_signature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono"
                        >
                          <ExternalLink className="w-3 h-3" />
                          View
                        </a>
                      ) : (
                        <span className="text-amber-100/40">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* x402 Protected Report */}
      <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-amber-100">x402 Protected Report</h3>
            <p className="text-xs text-amber-100/40 mt-0.5">
              Access compliance reports via HTTP 402 payment protocol (1 USDC)
            </p>
          </div>
          <button
            onClick={accessProtectedReport}
            disabled={x402Loading || !publicKey || !sendTransaction}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
              bg-amber-500 text-black hover:bg-amber-400
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {x402Loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {x402Loading ? 'Generating proof + paying...' : 'Access Protected Report'}
          </button>
        </div>

        {x402Loading && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-400 mb-4">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs">Generating ZK proof and processing USDC payment...</p>
              <p className="text-xs text-amber-100/50 mt-0.5">This may take several minutes</p>
            </div>
            <span className="font-mono text-sm text-amber-400/80">{formatElapsed(elapsedSec)}</span>
          </div>
        )}

        {x402Result && (
          <div className="space-y-3">
            {x402Result.payment && (
              <div className="p-4 rounded-lg bg-green-400/5 border border-green-400/10">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-400">Payment verified on-chain</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-amber-100/40">Transaction</span>
                    <a
                      href={config.txExplorerUrl(x402Result.payment.txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono mt-0.5"
                    >
                      {truncateAddress(x402Result.payment.txSignature, 8)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div>
                    <span className="text-amber-100/40">Amount</span>
                    <p className="text-amber-100 font-mono mt-0.5">{x402Result.payment.amount}</p>
                  </div>
                  <div>
                    <span className="text-amber-100/40">Payer</span>
                    <p className="text-amber-100 font-mono mt-0.5">{truncateAddress(x402Result.payment.payer, 6)}</p>
                  </div>
                  <div>
                    <span className="text-amber-100/40">ZK Proof Hash</span>
                    <p className="text-amber-400 font-mono mt-0.5 text-xs break-all">
                      {x402Result.payment.zkProofHash
                        ? truncateAddress(x402Result.payment.zkProofHash, 10)
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-amber-100/40">Endpoint</span>
                    <p className="text-amber-100 font-mono mt-0.5">/compliance/protected-report</p>
                  </div>
                </div>
              </div>
            )}

            {x402Result.success && x402Result.data ? (
              <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                <span className="text-xs text-amber-100/40 block mb-2">Compliance Report</span>
                <pre className="text-xs text-amber-100 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(x402Result.data, null, 2)}
                </pre>
              </div>
            ) : null}

            {!x402Result.success && x402Result.error ? (
              <div className="p-4 rounded-lg bg-red-400/10 border border-red-400/20">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium text-red-400">x402 flow failed</span>
                </div>
                <pre className="text-xs text-red-300 font-mono whitespace-pre-wrap break-words">
                  {x402Result.error}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* MPP Protected Service (B-flow with full Stripe Elements + on-chain ZK) */}
      <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-purple-400/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-amber-100">MPP Protected Service</h3>
            <p className="text-xs text-amber-100/40 mt-0.5">
              Stripe-backed HTTP 402 paywall with on-chain ZK proof verification ($1.00)
            </p>
          </div>
          {!mppChallenge && (
            <button
              onClick={startMppFlow}
              disabled={
                mppLoading ||
                !publicKey ||
                !sendTransaction ||
                !mppPublicConfig?.stripe.publishableKey
              }
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                bg-purple-500 text-black hover:bg-purple-400
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mppLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {mppLoading ? 'Starting…' : 'Access MPP Service'}
            </button>
          )}
        </div>

        {!mppPublicConfig?.stripe.publishableKey && (
          <div className="p-3 rounded-lg bg-amber-400/5 border border-amber-400/20 text-amber-100/60 text-xs mb-3">
            Stripe publishable key not configured on the compliance-api. Set
            <code className="mx-1 text-amber-400">STRIPE_PUBLISHABLE_KEY</code>
            in the compliance-api environment and restart to enable this card.
          </div>
        )}

        {mppChallenge && (
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-purple-400/5 border border-purple-400/20">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-purple-300">
                  Stripe PaymentIntent: ${mppChallenge.request.amount} {mppChallenge.request.currency.toUpperCase()}
                </div>
                <div className="text-xs text-amber-100/40 font-mono">
                  {truncateAddress(mppChallenge.stripe.paymentIntentId, 6)}
                </div>
              </div>
              <p className="text-xs text-amber-100/50 mb-3">
                Test mode: use <code className="text-amber-400">4242 4242 4242 4242</code>, any future expiry, any CVC, any ZIP.
              </p>
              <div
                ref={cardMountRef}
                className="p-3 rounded bg-[rgba(0,0,0,0.5)] border border-amber-400/10 min-h-[42px]"
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={confirmMppCardAndComplete}
                  disabled={mppLoading || !cardReady}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                    bg-purple-500 text-black hover:bg-purple-400
                    disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {mppLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
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
                  className="px-4 py-2 rounded-lg text-sm font-medium
                    bg-amber-100/5 text-amber-100/60 border border-amber-400/20
                    hover:bg-amber-100/10 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {mppStatus && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-400/10 border border-purple-400/20 text-purple-300 mt-3">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <p className="text-xs">{mppStatus}</p>
          </div>
        )}

        {mppError && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 mt-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <pre className="text-xs whitespace-pre-wrap break-words flex-1 font-mono">{mppError}</pre>
            <button onClick={() => setMppError(null)} aria-label="Dismiss MPP error">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {mppResult && (
          <div className="space-y-3 mt-3">
            {mppResult.payment && (
              <div className="p-4 rounded-lg bg-green-400/5 border border-green-400/10">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium text-green-400">
                    Stripe charged + on-chain MPP proof verified
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-amber-100/40">Stripe PI</span>
                    <a
                      href={getStripeDashboardUrl(
                        mppResult.payment.stripePaymentIntent,
                        mppPublicConfig?.stripe.isTestMode ?? true,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-purple-400 hover:text-purple-300 font-mono mt-0.5"
                      title="View on Stripe Dashboard"
                    >
                      {truncateAddress(mppResult.payment.stripePaymentIntent, 6)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div>
                    <span className="text-amber-100/40">Amount</span>
                    <p className="text-amber-100 font-mono mt-0.5">{mppResult.payment.amount}</p>
                  </div>
                  <div>
                    <span className="text-amber-100/40">Solana TX</span>
                    <a
                      href={config.txExplorerUrl(mppResult.payment.txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-purple-400 hover:text-purple-300 font-mono mt-0.5"
                    >
                      {truncateAddress(mppResult.payment.txSignature, 8)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div>
                    <span className="text-amber-100/40">ProofRecord PDA</span>
                    <a
                      href={config.explorerUrl(mppResult.payment.proofRecordPda)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-purple-400 hover:text-purple-300 font-mono mt-0.5"
                    >
                      {truncateAddress(mppResult.payment.proofRecordPda, 8)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="col-span-2">
                    <span className="text-amber-100/40">Poseidon Receipt Hash</span>
                    <p className="text-purple-300 font-mono mt-0.5 text-xs break-all">
                      {mppResult.payment.poseidonHash}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {mppResult.success && mppResult.data ? (
              <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                <span className="text-xs text-amber-100/40 block mb-2">Unlocked MPP Service Response</span>
                <pre className="text-xs text-amber-100 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(mppResult.data, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ZK Compression Cost Savings (collapsible) */}
      {proofs.length > 0 && (
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl">
          <button
            onClick={() => setShowCostSavings(!showCostSavings)}
            className="flex items-center justify-between w-full p-4 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-amber-100">ZK Compression Cost Savings</span>
              <span className="text-xs text-amber-100/50">Light Protocol</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-amber-100/40 transition-transform ${showCostSavings ? 'rotate-180' : ''}`} />
          </button>
          {showCostSavings && <div className="px-4 pb-4 pt-0">

          {(() => {
            const cost = getProofRecordCostComparison();
            const totalProofs = proofs.length;
            const regularTotal = cost.regularAccountRentLamports * totalProofs;
            const compressedTotal = cost.compressedTokenCostLamports * totalProofs;
            const savedTotal = regularTotal - compressedTotal;

            return (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-red-400/5 border border-red-400/10">
                    <span className="text-xs text-red-400/60 block mb-1">Regular PDA Cost</span>
                    <p className="text-lg font-mono text-red-400 font-bold">
                      {lamportsToSol(regularTotal)} SOL
                    </p>
                    <p className="text-xs text-amber-100/50 mt-1">
                      {lamportsToSol(cost.regularAccountRentLamports)} SOL x {totalProofs} proofs
                    </p>
                  </div>

                  <div className="p-4 rounded-lg bg-green-400/5 border border-green-400/10">
                    <span className="text-xs text-green-400/60 block mb-1">Compressed Cost</span>
                    <p className="text-lg font-mono text-green-400 font-bold">
                      {lamportsToSol(compressedTotal)} SOL
                    </p>
                    <p className="text-xs text-amber-100/50 mt-1">
                      {lamportsToSol(cost.compressedTokenCostLamports)} SOL x {totalProofs} proofs
                    </p>
                  </div>

                  <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                    <span className="text-xs text-amber-400/60 block mb-1">Total Saved</span>
                    <p className="text-lg font-mono text-amber-400 font-bold">
                      {lamportsToSol(savedTotal)} SOL
                    </p>
                    <p className="text-xs text-amber-100/50 mt-1">
                      {cost.savingsMultiplier}x cheaper ({cost.savingsPercent}% savings)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-amber-100/50">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span>
                    {isLightProtocolConfigured()
                      ? 'Light Protocol ZK Compression active'
                      : 'Light Protocol available (configure NEXT_PUBLIC_LIGHT_RPC_URL to activate)'}
                  </span>
                </div>
              </div>
            );
          })()}
          </div>}
        </div>
      )}
    </div>
  );
}
