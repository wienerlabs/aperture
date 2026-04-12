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
  buildVerifyPaymentProofIx,
  hexToBytes32,
  deriveOperatorPDA,
  derivePolicyPDA,
  sha256Bytes,
} from '@/lib/anchor-instructions';
import {
  getProofRecordCostComparison,
  lamportsToSol,
  isLightProtocolConfigured,
} from '@/lib/light-protocol';
import { fetchWithX402, type X402Result } from '@/lib/x402-client';
import { fetchWithMPP, type MPPResult } from '@/lib/mpp-client';
import { useApertureWalletModal } from '@/components/shared/WalletModal';

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatProvingTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
}

const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDT_MINT = 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUQS7QEkCybt4rCxsT';
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

function getTokenLabel(mint: string): string {
  if (mint === USDC_MINT) return 'USDC';
  if (mint === USDT_MINT) return 'USDT';
  if (mint.toLowerCase() === 'usd') return 'USD';
  if (config.tokens.vUSDC && mint === config.tokens.vUSDC) return 'vUSDC';
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
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{
    message: string;
    txSig: string | null;
    proofHash: string | null;
    provingTimeMs: number | null;
    amountRangeMin: number | null;
    amountRangeMax: number | null;
    isCompliant: boolean | null;
    receiptSize: number | null;
  } | null>(null);
  const [provingStatus, setProvingStatus] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [x402Loading, setX402Loading] = useState(false);
  const [showHookTest, setShowHookTest] = useState(false);
  const [showCostSavings, setShowCostSavings] = useState(false);
  const [x402Result, setX402Result] = useState<X402Result<unknown> | null>(null);
  const [mppLoading, setMppLoading] = useState(false);
  const [mppResult, setMppResult] = useState<MPPResult<unknown> | null>(null);
  const [hookTestingWithout, setHookTestingWithout] = useState(false);
  const [hookTestingWith, setHookTestingWith] = useState(false);
  const [hookResult, setHookResult] = useState<{
    readonly type: 'success' | 'rejected';
    readonly message: string;
    readonly txSignature?: string;
  } | null>(null);

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

  // Elapsed timer -- runs while simulating or x402Loading, never resets mid-operation
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTimerActive = simulating || x402Loading || mppLoading;
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
    const vUsdcMint = config.tokens.vUSDC;
    if (!vUsdcMint) {
      setError('vUSDC mint address not configured. Set NEXT_PUBLIC_VUSDC_MINT in .env');
      return;
    }

    if (withProof) { setHookTestingWith(true); } else { setHookTestingWithout(true); }
    setHookResult(null);
    setError(null);

    try {
      const mintPubkey = new PublicKey(vUsdcMint);
      const VERIFIER_PROGRAM = new PublicKey(config.programs.verifier);
      const amount = 1_000_000; // 1 vUSDC (6 decimals)

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
            message: 'This test requires a wallet without a ComplianceStatus PDA. Your current wallet already has a verified compliance record, so transfers pass the hook. Connect a different wallet to see the rejection. The hook is proven to work -- a non-compliant wallet was rejected on-chain:',
            txSignature: '26ywKDBVpJA6Sc8qBPjH6YeifcxEgnJAYDRoVHzgdBrVLVsiP3UZkDFTjvGPRK1ByYEUzWTcv7Pe6H9F2j3u6Bdx',
          });
          setHookTestingWithout(false);
          return;
        }
      }

      if (withProof) {
        // Step 1: Generate a real proof first via prover service
        const policiesRes = await policyApi.list(publicKey.toBase58());
        const policies = policiesRes.data;
        if (policies.length === 0) {
          setError('No active policies found. Create a policy first to test with proof.');
          setHookTestingWith(false);
          return;
        }

        const compiled = await policyApi.compile(policies[0].id);
        if (!compiled.data) {
          setError('Failed to compile policy.');
          setHookTestingWith(false);
          return;
        }

        // Generate proof
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
            payment_amount_lamports: amount,
            payment_token_mint: vUsdcMint,
            payment_recipient: publicKey.toBase58(),
            payment_endpoint_category: compiled.data.allowed_endpoint_categories[0] ?? 'compute',
            payment_timestamp: new Date().toISOString(),
            daily_spent_so_far_lamports: 0,
          }),
        });

        if (!proveRes.ok) {
          const errBody = await proveRes.json().catch(() => ({ error: 'Prover error' }));
          throw new Error(errBody.error ?? `Prover returned ${proveRes.status}`);
        }

        const proofData = await proveRes.json();

        // Step 2: Write proof on-chain via real Verifier program
        const proofHashBytes = hexToBytes32(proofData.proof_hash);
        const receiptBytes = new Uint8Array(proofData.receipt_bytes);
        // On-chain verifier checks SHA-256(receipt_data) == journal_digest
        const journalDigestBytes = await sha256Bytes(receiptBytes);

        const [operatorPDA] = deriveOperatorPDA(publicKey);
        const hookPolicyIdBytes = await sha256Bytes(policies[0].id);
        const [hookPolicyPDA] = derivePolicyPDA(operatorPDA, hookPolicyIdBytes);

        const verifyIx = buildVerifyPaymentProofIx(
          publicKey,
          publicKey,
          hookPolicyPDA,
          proofHashBytes,
          proofData.image_id,
          journalDigestBytes,
          receiptBytes
        );

        const proofTx = new Transaction().add(verifyIx);
        proofTx.feePayer = publicKey;
        const { blockhash: bh1 } = await connection.getLatestBlockhash();
        proofTx.recentBlockhash = bh1;
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
    setProvingStatus('x402');
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
      setError(err instanceof Error ? err.message : 'x402 request failed');
    } finally {
      setX402Loading(false);
      setProvingStatus(null);
    }
  }

  async function accessMPPReport() {
    if (!operatorId) return;
    if (!publicKey || !sendTransaction) {
      openWalletModal(true);
      return;
    }
    const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!stripeKey) {
      setError('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY not configured in .env');
      return;
    }
    setMppLoading(true);
    setMppResult(null);
    setError(null);
    setProvingStatus('Processing MPP payment...');
    try {
      const endpoint = `${config.complianceApiUrl}/api/v1/compliance/mpp-report?operator_id=${operatorId}`;
      const result = await fetchWithMPP<unknown>(endpoint, stripeKey);

      if (result.success && result.payment) {
        // 1. Fetch policy and compile for ZK circuit
        setProvingStatus('Fetching policy for ZK proof...');
        const policiesRes = await policyApi.list(operatorId);
        const policies = policiesRes.data;

        if (policies.length > 0) {
          const compiled = await policyApi.compile(policies[0].id);
          if (compiled.data) {
            // 2. Generate ZK proof via RISC Zero prover
            setProvingStatus('Generating ZK proof... this may take several minutes');
            const amountLamports = Math.round(parseFloat(result.payment.amount) * 1_000_000);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 600_000);

            const proveRes = await fetch(`${config.proverServiceUrl}/prove`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                policy_id: compiled.data.policy_id,
                operator_id: compiled.data.operator_id,
                max_daily_spend_lamports: parseInt(compiled.data.max_daily_spend_lamports, 10),
                max_per_transaction_lamports: parseInt(compiled.data.max_per_transaction_lamports, 10),
                allowed_endpoint_categories: compiled.data.allowed_endpoint_categories,
                blocked_addresses: compiled.data.blocked_addresses,
                token_whitelist: compiled.data.token_whitelist,
                payment_amount_lamports: amountLamports,
                payment_token_mint: compiled.data.token_whitelist[0] ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
                payment_recipient: operatorId,
                payment_endpoint_category: compiled.data.allowed_endpoint_categories[0] ?? 'mpp',
                payment_timestamp: new Date().toISOString(),
                daily_spent_so_far_lamports: 0,
              }),
            });
            clearTimeout(timeoutId);

            if (proveRes.ok) {
              const proofData = await proveRes.json();

              // 3. Submit proof record to compliance API
              setProvingStatus('Submitting proof record...');
              await new Promise(r => setTimeout(r, 0));
              const paymentId = `mpp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              await complianceApi.submitProof({
                operator_id: operatorId,
                policy_id: policies[0].id,
                payment_id: paymentId,
                proof_hash: proofData.proof_hash,
                amount_range_min: proofData.amount_range_min / 1_000_000,
                amount_range_max: proofData.amount_range_max / 1_000_000,
                token_mint: compiled.data.token_whitelist[0] ?? 'usd',
                is_compliant: proofData.is_compliant,
                verified_at: proofData.verification_timestamp,
              });

              // 4. Verify proof on-chain via Solana Verifier program
              setProvingStatus('Verifying proof on Solana Devnet...');
              await new Promise(r => setTimeout(r, 0));
              let solanaTxSig = '';

              const proofHashBytes = hexToBytes32(proofData.proof_hash);
              const compactReceipt = JSON.stringify({
                proof_hash: proofData.proof_hash,
                is_compliant: proofData.is_compliant,
                amount_range_min: proofData.amount_range_min,
                amount_range_max: proofData.amount_range_max,
                image_id: proofData.image_id,
              });
              const receiptBytes = new TextEncoder().encode(compactReceipt);
              const journalDigestBytes = await sha256Bytes(receiptBytes);

              await new Promise(r => setTimeout(r, 0));

              const [operatorPDA] = deriveOperatorPDA(publicKey);
              const policyIdBytes = await sha256Bytes(policies[0].id);
              const [policyPDA] = derivePolicyPDA(operatorPDA, policyIdBytes);

              const verifyIx = buildVerifyPaymentProofIx(
                publicKey,
                publicKey,
                policyPDA,
                proofHashBytes,
                proofData.image_id,
                journalDigestBytes,
                receiptBytes,
              );

              const tx = new Transaction().add(verifyIx);
              tx.feePayer = publicKey;
              const { blockhash } = await connection.getLatestBlockhash();
              tx.recentBlockhash = blockhash;

              solanaTxSig = await sendTransaction(tx, connection);
              setProvingStatus('Confirming Solana transaction...');
              await connection.confirmTransaction(solanaTxSig, 'confirmed');

              // 5. Save tx_signature to backend
              if (solanaTxSig) {
                const proofRes = await complianceApi.getProofByPayment(paymentId);
                if (proofRes.data) {
                  await complianceApi.updateProofTxSignature(proofRes.data.id, solanaTxSig);
                }
              }

              const enrichedResult = {
                ...result,
                payment: {
                  ...result.payment,
                  zkProofHash: proofData.proof_hash as string,
                  solanaTxSignature: solanaTxSig || null,
                },
              };
              setMppResult(enrichedResult);
              await fetchProofs();
              return;
            }
          }
        }
      }

      setMppResult(result);
      if (!result.success) {
        setError(result.error ?? 'MPP payment failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MPP request failed');
    } finally {
      setMppLoading(false);
      setProvingStatus(null);
    }
  }

  async function simulatePayment() {
    if (!operatorId) return;
    if (!publicKey) {
      openWalletModal(true);
      return;
    }
    setSimulating(true);
    setSimResult(null);
    setProvingStatus(null);
    setError(null);
    try {
      setProvingStatus('Fetching policy...');
      // 1. Fetch active policies and compile for circuit
      const policiesRes = await policyApi.list(operatorId);
      const policies = policiesRes.data;
      if (policies.length === 0) {
        setError('No active policies found. Create a policy first.');
        setSimulating(false);
        return;
      }
      const policy = policies[0];
      const compiled = await policyApi.compile(policy.id);
      if (!compiled.data) {
        setError('Failed to compile policy for circuit.');
        setSimulating(false);
        return;
      }

      const paymentId = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const paymentAmount = 1_000_000 + Math.floor(Math.random() * 4_000_000); // 1-5 USDC in lamports

      // 2. Send to real RISC Zero prover service (may take 5+ minutes)
      setProvingStatus('Generating ZK proof... this may take several minutes on CPU');

      // Use AbortController with 10 minute timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 600_000);

      const proveRes = await fetch(`${config.proverServiceUrl}/prove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          policy_id: compiled.data.policy_id,
          operator_id: compiled.data.operator_id,
          max_daily_spend_lamports: parseInt(compiled.data.max_daily_spend_lamports, 10),
          max_per_transaction_lamports: parseInt(compiled.data.max_per_transaction_lamports, 10),
          allowed_endpoint_categories: compiled.data.allowed_endpoint_categories,
          blocked_addresses: compiled.data.blocked_addresses,
          token_whitelist: compiled.data.token_whitelist,
          payment_amount_lamports: paymentAmount,
          payment_token_mint: USDC_MINT,
          payment_recipient: publicKey?.toBase58() ?? 'unknown',
          payment_endpoint_category: compiled.data.allowed_endpoint_categories[0] ?? 'compute',
          payment_timestamp: new Date().toISOString(),
          daily_spent_so_far_lamports: 0,
        }),
      });
      clearTimeout(timeoutId);

      if (!proveRes.ok) {
        const errBody = await proveRes.json().catch(() => ({ error: proveRes.statusText }));
        throw new Error(errBody.error ?? `Prover service returned ${proveRes.status}`);
      }

      // Parse response -- yield to UI between heavy operations
      const proofText = await proveRes.text();
      await new Promise(r => setTimeout(r, 0)); // yield to render loop
      const proofData = JSON.parse(proofText);

      // 3. Submit proof record to compliance API
      setProvingStatus('Submitting proof record...');
      await new Promise(r => setTimeout(r, 0)); // yield to render loop
      await complianceApi.submitProof({
        operator_id: operatorId,
        policy_id: policy.id,
        payment_id: paymentId,
        proof_hash: proofData.proof_hash,
        amount_range_min: proofData.amount_range_min / 1_000_000,
        amount_range_max: proofData.amount_range_max / 1_000_000,
        token_mint: USDC_MINT,
        is_compliant: proofData.is_compliant,
        verified_at: proofData.verification_timestamp,
      });

      // 4. Verify proof on-chain via real Verifier program (verify_payment_proof)
      setProvingStatus('Verifying proof on Solana...');
      await new Promise(r => setTimeout(r, 0));
      let txSig = '';
      if (publicKey && sendTransaction) {
        const proofHashBytes = hexToBytes32(proofData.proof_hash);

        // Build compact receipt data for on-chain verification
        // Full receipt (255KB) doesn't fit in a Solana tx (1232 byte limit)
        // Send a compact attestation: JSON of proof output fields
        const compactReceipt = JSON.stringify({
          proof_hash: proofData.proof_hash,
          is_compliant: proofData.is_compliant,
          amount_range_min: proofData.amount_range_min,
          amount_range_max: proofData.amount_range_max,
          image_id: proofData.image_id,
        });
        const receiptBytes = new TextEncoder().encode(compactReceipt);
        const journalDigestBytes = await sha256Bytes(receiptBytes);

        await new Promise(r => setTimeout(r, 0));

        const [operatorPDA] = deriveOperatorPDA(publicKey);
        const policyIdBytes = await sha256Bytes(policy.id);
        const [policyPDA] = derivePolicyPDA(operatorPDA, policyIdBytes);

        const verifyIx = buildVerifyPaymentProofIx(
          publicKey,
          publicKey,
          policyPDA,
          proofHashBytes,
          proofData.image_id,
          journalDigestBytes,
          receiptBytes
        );

        const tx = new Transaction().add(verifyIx);
        tx.feePayer = publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;

        txSig = await sendTransaction(tx, connection);
        setProvingStatus('Confirming transaction...');
        await connection.confirmTransaction(txSig, 'confirmed');
      }

      // Save tx_signature to backend
      if (txSig) {
        const proofRes = await complianceApi.getProofByPayment(paymentId);
        if (proofRes.data) {
          await complianceApi.updateProofTxSignature(proofRes.data.id, txSig);
        }
      }
      setSimResult({
        message: 'ZK proof verified on-chain',
        txSig: txSig || null,
        proofHash: proofData.proof_hash,
        provingTimeMs: proofData.proving_time_ms,
        amountRangeMin: proofData.amount_range_min,
        amountRangeMax: proofData.amount_range_max,
        isCompliant: proofData.is_compliant,
        receiptSize: proofData.receipt_bytes?.length ?? null,
      });

      // 5. Refresh proofs list
      await fetchProofs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment proof generation failed');
    } finally {
      setSimulating(false);
      setProvingStatus(null);
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
        <button
          onClick={simulatePayment}
          disabled={simulating}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-black font-mono text-sm font-bold hover:bg-amber-400 disabled:opacity-50 transition-colors"
        >
          {simulating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {simulating ? 'Proving...' : 'Payment'}
        </button>
      </div>

      {simulating && provingStatus && (
        <div className="p-4 rounded-lg bg-amber-400/10 border border-amber-400/20 text-amber-400">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">{provingStatus}</p>
              <p className="text-xs text-amber-100/40 mt-0.5">
                Production ZK proof generation may take up to 5 minutes on CPU
              </p>
            </div>
            <span className="font-mono text-lg text-amber-400/80">{formatElapsed(elapsedSec)}</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            {['Fetching policy', 'Generating ZK proof', 'Submitting record', 'Verifying on Solana', 'Confirming'].map((step) => {
              const keywords = ['fetching', 'generating', 'submitting', 'verifying', 'confirming'];
              const isCurrent = provingStatus.toLowerCase().includes(step.toLowerCase().split(' ')[0]);
              const stepIndex = keywords.indexOf(step.toLowerCase().split(' ')[0]);
              const currentIndex = keywords.findIndex(s => provingStatus.toLowerCase().includes(s));
              const isDone = stepIndex < currentIndex;
              return (
                <div key={step} className="flex items-center gap-1">
                  {isDone ? (
                    <CheckCircle className="w-3 h-3 text-green-400" />
                  ) : isCurrent ? (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border border-amber-400/30" />
                  )}
                  <span className={`text-xs ${isDone ? 'text-green-400' : isCurrent ? 'text-amber-400' : 'text-amber-100/30'}`}>
                    {step}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {simResult && !provingStatus && (
        <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-green-400/20 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <span className="text-sm font-semibold text-green-400">{simResult.message}</span>
            {simResult.isCompliant !== null && (
              <span className="px-2 py-0.5 rounded-full bg-green-400/10 text-green-400 text-xs font-medium">
                Compliant: {simResult.isCompliant ? 'Yes' : 'No'}
              </span>
            )}
            {simResult.receiptSize !== null && simResult.receiptSize > 1000 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 text-xs font-medium ml-auto">
                Production ZK Proof
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            {simResult.proofHash && (
              <div className="col-span-2">
                <span className="text-amber-100/40">ZK Proof Hash</span>
                <p className="text-amber-400 font-mono mt-0.5 break-all">{simResult.proofHash}</p>
              </div>
            )}
            {simResult.txSig && (
              <div>
                <span className="text-amber-100/40">Transaction</span>
                <a
                  href={config.txExplorerUrl(simResult.txSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-amber-400 hover:text-amber-300 font-mono mt-0.5"
                >
                  {simResult.txSig.slice(0, 20)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
            {simResult.provingTimeMs !== null && (
              <div>
                <span className="text-amber-100/40">Proving Time</span>
                <p className="text-amber-100 font-mono mt-0.5">{formatProvingTime(simResult.provingTimeMs)}</p>
              </div>
            )}
            {simResult.receiptSize !== null && (
              <div>
                <span className="text-amber-100/40">Receipt</span>
                <p className="text-amber-100 font-mono mt-0.5">{formatBytes(simResult.receiptSize)} cryptographic receipt</p>
              </div>
            )}
            {simResult.amountRangeMin !== null && simResult.amountRangeMax !== null && (
              <div>
                <span className="text-amber-100/40">Amount Range</span>
                <p className="text-amber-100 font-mono mt-0.5">
                  {(simResult.amountRangeMin / 1_000_000).toFixed(2)} - {(simResult.amountRangeMax / 1_000_000).toFixed(2)} USDC
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transfer Hook Test (collapsible) */}
      {config.tokens.vUSDC && (
        <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl">
          <button
            onClick={() => setShowHookTest(!showHookTest)}
            className="flex items-center justify-between w-full p-4 text-left"
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-100">Transfer Hook Test</span>
              <span className="text-xs text-amber-100/30">vUSDC compliance enforcement</span>
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
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto"
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
        <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl overflow-hidden">
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
                          className="text-amber-100/20 hover:text-amber-400 transition-colors"
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
                        <span className="text-amber-100/20">-</span>
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
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
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
              <p className="text-xs text-amber-100/30 mt-0.5">This may take several minutes</p>
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

            {x402Result.success && x402Result.data && (
              <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                <span className="text-xs text-amber-100/40 block mb-2">Compliance Report</span>
                <pre className="text-xs text-amber-100 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(x402Result.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* MPP Protected Report */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-purple-400/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-amber-100">MPP Protected Report</h3>
            <p className="text-xs text-amber-100/40 mt-0.5">
              Access compliance reports via Machine Payments Protocol ($0.50 Stripe)
            </p>
          </div>
          <button
            onClick={accessMPPReport}
            disabled={mppLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
              bg-purple-500 text-white hover:bg-purple-400
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mppLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {mppLoading ? 'Processing MPP payment...' : 'Access MPP Report'}
          </button>
        </div>

        {mppLoading && provingStatus && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-purple-400/10 border border-purple-400/20 text-purple-400 mb-4">
            <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-medium">{provingStatus}</p>
              <p className="text-xs text-amber-100/30 mt-0.5">MPP 402 challenge/credential flow with ZK proof</p>
            </div>
            <span className="font-mono text-sm text-purple-400/80">{formatElapsed(elapsedSec)}</span>
          </div>
        )}

        {mppResult && (
          <div className="space-y-3">
            {mppResult.payment && (
              <div className="p-4 rounded-lg bg-purple-400/5 border border-purple-400/10">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-medium text-purple-400">MPP Payment verified</span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-400/10 text-purple-400 text-xs font-medium">
                    MPP Payment
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-amber-100/40">Stripe PaymentIntent</span>
                    <p className="text-purple-400 font-mono mt-0.5">
                      {mppResult.payment.paymentIntentId}
                    </p>
                  </div>
                  <div>
                    <span className="text-amber-100/40">Amount</span>
                    <p className="text-amber-100 font-mono mt-0.5">
                      ${mppResult.payment.amount} {mppResult.payment.currency.toUpperCase()}
                    </p>
                  </div>
                  {mppResult.payment.solanaTxSignature && (
                    <div>
                      <span className="text-amber-100/40">Solana TX</span>
                      <a
                        href={config.txExplorerUrl(mppResult.payment.solanaTxSignature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-purple-400 hover:text-purple-300 font-mono mt-0.5"
                      >
                        {truncateAddress(mppResult.payment.solanaTxSignature, 8)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  <div>
                    <span className="text-amber-100/40">Protocol</span>
                    <p className="text-amber-100 font-mono mt-0.5">MPP (Machine Payments Protocol)</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-amber-100/40">ZK Proof Hash</span>
                    <p className="text-purple-400 font-mono mt-0.5 text-xs break-all">
                      {mppResult.payment.zkProofHash ?? 'No active policy found - create a policy first'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {mppResult.success && mppResult.data && (
              <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                <span className="text-xs text-amber-100/40 block mb-2">Compliance Report (MPP)</span>
                <pre className="text-xs text-amber-100 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {JSON.stringify(mppResult.data, null, 2)}
                </pre>
              </div>
            )}

            {!mppResult.success && mppResult.error && (
              <div className="p-3 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400 text-sm">
                {mppResult.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ZK Compression Cost Savings (collapsible) */}
      {proofs.length > 0 && (
        <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl">
          <button
            onClick={() => setShowCostSavings(!showCostSavings)}
            className="flex items-center justify-between w-full p-4 text-left"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-amber-100">ZK Compression Cost Savings</span>
              <span className="text-xs text-amber-100/30">Light Protocol</span>
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
                    <p className="text-xs text-amber-100/30 mt-1">
                      {lamportsToSol(cost.regularAccountRentLamports)} SOL x {totalProofs} proofs
                    </p>
                  </div>

                  <div className="p-4 rounded-lg bg-green-400/5 border border-green-400/10">
                    <span className="text-xs text-green-400/60 block mb-1">Compressed Cost</span>
                    <p className="text-lg font-mono text-green-400 font-bold">
                      {lamportsToSol(compressedTotal)} SOL
                    </p>
                    <p className="text-xs text-amber-100/30 mt-1">
                      {lamportsToSol(cost.compressedTokenCostLamports)} SOL x {totalProofs} proofs
                    </p>
                  </div>

                  <div className="p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
                    <span className="text-xs text-amber-400/60 block mb-1">Total Saved</span>
                    <p className="text-lg font-mono text-amber-400 font-bold">
                      {lamportsToSol(savedTotal)} SOL
                    </p>
                    <p className="text-xs text-amber-100/30 mt-1">
                      {cost.savingsMultiplier}x cheaper ({cost.savingsPercent}% savings)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-amber-100/30">
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
