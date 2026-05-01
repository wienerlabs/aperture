'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import { config } from '@/lib/config';
import {
  BarChart3,
  Plus,
  ExternalLink,
  Copy,
  Loader2,
  AlertTriangle,
  X,
  CheckCircle,
  Shield,
} from 'lucide-react';
import {
  complianceApi,
  type Attestation,
  type BatchAttestationOutput,
} from '@/lib/api';
import { formatDate, formatAmount, truncateAddress } from '@/lib/utils';
import { buildVerifyBatchAttestationIx, hexToBytes32, sha256Bytes } from '@/lib/anchor-instructions';


interface AttestationFormData {
  readonly period_start: string;
  readonly period_end: string;
}

const INITIAL_FORM_DATA: AttestationFormData = {
  period_start: '',
  period_end: '',
};

const REFRESH_INTERVAL_MS = 5_000;


export function ComplianceTab() {
  const operatorId = useOperatorId();
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [attestations, setAttestations] = useState<readonly Attestation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<AttestationFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchAttestationOutput | null>(null);

  const fetchAttestations = useCallback(
    async (showSpinner = false) => {
      if (!operatorId) return;
      if (showSpinner) setLoading(true);
      try {
        const response = await complianceApi.listAttestations(operatorId);
        setAttestations(response.data);
        setError(null);
      } catch (err: unknown) {
        // Only surface errors during the initial load; silent failure on background polls
        // avoids flashing transient network errors while the user is mid-flow.
        if (showSpinner) {
          const message =
            err instanceof Error ? err.message : 'Failed to fetch attestations';
          setError(message);
        }
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [operatorId]
  );

  useEffect(() => {
    fetchAttestations(true);
    const interval = setInterval(() => fetchAttestations(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAttestations]);

  function updateFormField<K extends keyof AttestationFormData>(
    field: K,
    value: AttestationFormData[K]
  ): void {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function resetForm(): void {
    setFormData(INITIAL_FORM_DATA);
    setShowForm(false);
    setBatchResult(null);
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!operatorId) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await complianceApi.createBatchAttestation({
        operator_id: operatorId,
        period_start: new Date(formData.period_start).toISOString(),
        period_end: new Date(formData.period_end).toISOString(),
      });
      if (response.data) {
        setBatchResult(response.data);

        // Verify attestation on-chain via real Verifier program (verify_batch_attestation)
        if (publicKey && sendTransaction) {
          const batchHashBytes = hexToBytes32(response.data.proof_hash);
          const batchImageId = [0, 0, 0, 0, 0, 0, 0, 0];

          const periodStartTs = BigInt(Math.floor(new Date(response.data.period_start).getTime() / 1000));
          const periodEndTs = BigInt(Math.floor(new Date(response.data.period_end).getTime() / 1000));

          // verify_batch.rs requires receipt_data == "batch:{hex}:{total}:{start}:{end}"
          // so that sha256(receipt_data) == journal_digest == compute_batch_digest(...).
          // Must match the format the agent uses (services/agent-service/src/agent-loop.ts).
          const batchHashHex = response.data.proof_hash.startsWith('0x')
            ? response.data.proof_hash.slice(2)
            : response.data.proof_hash;
          const digestInput = `batch:${batchHashHex}:${response.data.total_payments}:${periodStartTs}:${periodEndTs}`;
          const receiptBytes = new TextEncoder().encode(digestInput);
          const journalDigestBytes = await sha256Bytes(receiptBytes);

          const verifyBatchIx = buildVerifyBatchAttestationIx(
            publicKey,
            publicKey,
            batchHashBytes,
            batchImageId,
            journalDigestBytes,
            response.data.total_payments,
            periodStartTs,
            periodEndTs,
            receiptBytes
          );

          const tx = new Transaction().add(verifyBatchIx);
          tx.feePayer = publicKey;
          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;

          const sig = await sendTransaction(tx, connection);
          await connection.confirmTransaction(sig, 'confirmed');
          // Save tx_signature to backend
          await complianceApi.updateTxSignature(response.data!.id, sig);
        }
      }
      await fetchAttestations(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to create batch attestation';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function copyAuditLink(attestationId: string): Promise<void> {
    const url = `${window.location.origin}/audit/${attestationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(attestationId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }

  if (!operatorId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
        <BarChart3 className="w-12 h-12 mb-4" />
        <p className="text-lg">Connect your wallet to view compliance data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-amber-100">Compliance</h2>
          <p className="text-amber-100/40 text-sm mt-1">
            Batch attestations and cryptographic compliance proofs
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg px-6 py-2 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Create Batch Attestation
        </button>
      </div>

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

      {/* Create Form */}
      {showForm && (
        <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-amber-100">
              Create Batch Attestation
            </h3>
            <button
              onClick={resetForm}
              className="text-amber-100/40 hover:text-amber-100"
              aria-label="Close form"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {!batchResult ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-amber-100/60 mb-1.5">
                    Period Start
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.period_start}
                    onChange={(e) => updateFormField('period_start', e.target.value)}
                    className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-amber-100/60 mb-1.5">
                    Period End
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.period_end}
                    onChange={(e) => updateFormField('period_end', e.target.value)}
                    className="w-full bg-transparent border border-amber-400/20 focus:border-amber-400 rounded-lg px-4 py-2 text-amber-100 outline-none transition-colors [color-scheme:dark]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 rounded-lg text-sm text-amber-100/60 hover:text-amber-100 border border-amber-400/20 hover:border-amber-400/40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold rounded-lg px-6 py-2 transition-colors"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Generate Attestation
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-amber-400 mb-4">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Batch attestation created successfully</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-amber-100/40">Total Payments</span>
                  <p className="text-amber-100 font-mono">{batchResult.total_payments}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Amount Range</span>
                  <p className="text-amber-100 font-mono">
                    {formatAmount(batchResult.total_amount_range.min)} -{' '}
                    {formatAmount(batchResult.total_amount_range.max)}
                  </p>
                </div>
                <div>
                  <span className="text-amber-100/40">Policy Violations</span>
                  <p className="text-amber-100 font-mono">{batchResult.policy_violations}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Proof Hash</span>
                  <p className="text-amber-400 font-mono text-xs break-all">
                    {batchResult.proof_hash}
                  </p>
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={resetForm}
                  className="px-4 py-2 rounded-lg text-sm bg-amber-500 hover:bg-amber-400 text-black font-bold transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && attestations.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
          <BarChart3 className="w-12 h-12 mb-4" />
          <p className="text-lg">No attestations created yet</p>
          <p className="text-sm mt-1">
            Create a batch attestation to generate cryptographic compliance proofs
          </p>
        </div>
      )}

      {/* Attestation cards */}
      {!loading && attestations.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {attestations.map((attestation) => (
            <div
              key={attestation.id}
              className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-amber-100">
                      Batch Attestation
                    </h3>
                    <span className="px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 text-xs font-medium">
                      {attestation.status}
                    </span>
                  </div>
                  <p className="text-xs text-amber-100/40 font-mono">
                    {truncateAddress(attestation.id, 8)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div>
                  <span className="text-amber-100/40">Period</span>
                  <p className="text-amber-100">
                    {formatDate(attestation.period_start)} - {formatDate(attestation.period_end)}
                  </p>
                </div>
                <div>
                  <span className="text-amber-100/40">Total Payments</span>
                  <p className="text-amber-100 font-mono">{attestation.total_payments}</p>
                </div>
                <div>
                  <span className="text-amber-100/40">Amount Range</span>
                  <p className="text-amber-100 font-mono">
                    {formatAmount(attestation.total_amount_range_min)} -{' '}
                    {formatAmount(attestation.total_amount_range_max)}
                  </p>
                </div>
                <div>
                  <span className="text-amber-100/40">Policy Violations</span>
                  <p className="text-amber-100 font-mono">{attestation.policy_violations}</p>
                </div>
              </div>

              <div className="mb-4">
                <span className="text-xs text-amber-100/40">Batch Proof Hash</span>
                <p className="text-xs text-amber-400 font-mono break-all mt-0.5">
                  {attestation.batch_proof_hash}
                </p>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-amber-400/10">
                {attestation.tx_signature ? (
                  <a
                    href={config.txExplorerUrl(attestation.tx_signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                      text-amber-400 hover:bg-amber-400/10 border border-amber-400/20 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View on Solana
                  </a>
                ) : (
                  <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-400/30 border border-amber-400/10">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Off-chain
                  </span>
                )}
                <button
                  onClick={() => copyAuditLink(attestation.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                    text-amber-100/60 hover:text-amber-100 hover:bg-amber-400/10 border border-amber-400/20 transition-colors"
                >
                  {copiedId === attestation.id ? (
                    <>
                      <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                      <span className="text-green-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Share Audit Link
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
