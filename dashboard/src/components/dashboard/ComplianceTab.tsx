'use client';

import { useState, useEffect, useCallback } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { Transaction } from '@solana/web3.js';
import {
  BarChart3,
  Plus,
  Loader2,
  AlertTriangle,
  X,
  CheckCircle,
  Stamp,
  Wallet,
} from 'lucide-react';
import {
  complianceApi,
  type Attestation,
  type BatchAttestationOutput,
} from '@/lib/api';
import { formatAmount } from '@/lib/utils';
import {
  buildVerifyBatchAttestationIx,
  hexToBytes32,
  sha256Bytes,
} from '@/lib/anchor-instructions';
import { ApInput } from './policies/ApField';
import { ComplianceStatsRow } from './compliance/ComplianceStatsRow';
import { MerkleTreeViewer } from './compliance/MerkleTreeViewer';
import { AttestationCard } from './compliance/AttestationCard';
import { AuditTrailTimeline } from './compliance/AuditTrailTimeline';
import { ProofIntegrityCard } from './compliance/ProofIntegrityCard';

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
        // Only surface errors during the initial load; silent failure on
        // background polls avoids flashing transient network errors while
        // the user is mid-flow.
        if (showSpinner) {
          const message =
            err instanceof Error ? err.message : 'Failed to fetch attestations';
          setError(message);
        }
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [operatorId],
  );

  useEffect(() => {
    fetchAttestations(true);
    const interval = setInterval(() => fetchAttestations(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAttestations]);

  function updateFormField<K extends keyof AttestationFormData>(
    field: K,
    value: AttestationFormData[K],
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

        // Verify attestation on-chain via real Verifier program
        // (verify_batch_attestation)
        if (publicKey && sendTransaction) {
          const batchHashBytes = hexToBytes32(response.data.proof_hash);
          const batchImageId = [0, 0, 0, 0, 0, 0, 0, 0];

          const periodStartTs = BigInt(
            Math.floor(new Date(response.data.period_start).getTime() / 1000),
          );
          const periodEndTs = BigInt(
            Math.floor(new Date(response.data.period_end).getTime() / 1000),
          );

          // verify_batch.rs requires receipt_data ==
          //   "batch:{hex}:{total}:{start}:{end}"
          // so that sha256(receipt_data) == journal_digest ==
          // compute_batch_digest(...). Must match the format the agent uses
          // in services/agent-service/src/agent-loop.ts.
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
            receiptBytes,
          );

          const tx = new Transaction().add(verifyBatchIx);
          tx.feePayer = publicKey;
          const { blockhash } = await connection.getLatestBlockhash();
          tx.recentBlockhash = blockhash;

          const sig = await sendTransaction(tx, connection);
          await connection.confirmTransaction(sig, 'confirmed');
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
      /* clipboard API may be unavailable in some contexts */
    }
  }

  if (!operatorId) {
    return (
      <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
          <Wallet className="h-6 w-6" />
        </span>
        <h2 className="font-display text-[24px] tracking-[-0.012em] text-black">
          Connect a wallet to view compliance data
        </h2>
        <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
          Each operator&apos;s batch attestations and audit trail are namespaced to its
          wallet pubkey. Connect to load and anchor your compliance proofs.
        </p>
      </div>
    );
  }

  const latestAttestation = attestations[0] ?? null;

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
              <Stamp className="h-3 w-3" />
              Compliance &amp; Attestations
            </span>
            <h1 className="font-display text-[36px] sm:text-[44px] leading-[1.04] tracking-[-0.012em] text-black">
              Anchor your batches.
              <br />
              Reveal nothing.
            </h1>
            <p className="text-[14px] text-black/55 tracking-tighter max-w-2xl">
              Generate Merkle-rooted batch attestations across any period. Every root
              lands on Solana via verify_batch_attestation, so an external auditor can
              reproduce your compliance posture without seeing the underlying rules.
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="ap-btn-orange inline-flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Batch Attestation
            </button>
            <span className="text-[11px] text-black/45 tracking-tighter">
              Signs verify_batch_attestation against the verifier program
            </span>
          </div>
        </div>
      </section>

      {/* Stats */}
      <ComplianceStatsRow attestations={attestations} />

      {/* Top-level error */}
      {error && (
        <div className="ap-card p-4 flex items-start gap-3" style={{ borderColor: '#fca5a5' }}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-600" />
          <p className="text-[13px] text-red-700 tracking-tighter flex-1">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto flex-shrink-0 text-black/45 hover:text-black"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <section className="ap-card p-6 sm:p-7">
          <header className="flex items-start justify-between gap-3 mb-6">
            <div>
              <h3 className="font-display text-[22px] tracking-[-0.005em] text-black">
                Create Batch Attestation
              </h3>
              <p className="text-[12px] text-black/55 tracking-tighter mt-1">
                Aggregates every proof in the period into a Merkle root, signs the
                verifier instruction, and records a transaction on Devnet.
              </p>
            </div>
            <button
              onClick={resetForm}
              className="inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/55 hover:bg-black/5 hover:text-black transition-colors"
              aria-label="Close form"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {!batchResult ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <ApInput
                  label="Period Start"
                  type="date"
                  required
                  value={formData.period_start}
                  onChange={(e) => updateFormField('period_start', e.target.value)}
                  helper="Inclusive lower bound — UTC midnight."
                />
                <ApInput
                  label="Period End"
                  type="date"
                  required
                  value={formData.period_end}
                  onChange={(e) => updateFormField('period_end', e.target.value)}
                  helper="Exclusive upper bound — UTC midnight of the next day."
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-black/8">
                <button
                  type="button"
                  onClick={resetForm}
                  className="ap-btn-ghost-light"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Generate Attestation
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-aperture-dark">
                <CheckCircle className="h-5 w-5" />
                <span className="text-[14px] font-medium tracking-tighter text-black">
                  Batch attestation created &amp; anchored
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-3">
                <ResultCell label="Total Payments" value={String(batchResult.total_payments)} mono />
                <ResultCell
                  label="Amount Range"
                  value={`${formatAmount(batchResult.total_amount_range.min)} – ${formatAmount(
                    batchResult.total_amount_range.max,
                  )}`}
                  mono
                />
                <ResultCell
                  label="Policy Violations"
                  value={String(batchResult.policy_violations)}
                  mono
                  accent={batchResult.policy_violations === 0 ? 'green' : 'red'}
                />
                <ResultCell
                  label="Proof Hash"
                  value={batchResult.proof_hash}
                  mono
                  fullWidth
                />
              </dl>
              <div className="flex justify-end pt-3 border-t border-black/8">
                <button onClick={resetForm} className="ap-btn-orange">
                  Done
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Loading */}
      {loading && (
        <div className="ap-card p-12 flex items-center justify-center">
          <Loader2 className="h-7 w-7 text-aperture animate-spin" />
        </div>
      )}

      {/* Empty state */}
      {!loading && attestations.length === 0 && !error && (
        <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
            <BarChart3 className="h-6 w-6" />
          </span>
          <h3 className="font-display text-[22px] tracking-[-0.005em] text-black">
            No attestations yet
          </h3>
          <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
            Create your first batch attestation to fold every proof in a period into a
            single Merkle root and anchor it on Solana.
          </p>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="ap-btn-orange inline-flex items-center gap-2 mt-2"
          >
            <Plus className="h-4 w-4" />
            Create your first attestation
          </button>
        </div>
      )}

      {/* Cryptographic context — Merkle viewer + integrity card */}
      {!loading && attestations.length > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <MerkleTreeViewer rootHash={latestAttestation!.batch_proof_hash} />
          </div>
          <div className="lg:col-span-1">
            <AuditTrailTimeline attestations={attestations} />
          </div>
        </section>
      )}

      {!loading && attestations.length > 0 && <ProofIntegrityCard />}

      {/* Attestation cards */}
      {!loading && attestations.length > 0 && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {attestations.map((attestation) => (
            <AttestationCard
              key={attestation.id}
              attestation={attestation}
              onShareAudit={copyAuditLink}
              copied={copiedId === attestation.id}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function ResultCell({
  label,
  value,
  mono,
  accent,
  fullWidth,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: 'green' | 'red';
  fullWidth?: boolean;
}) {
  const tone =
    accent === 'green' ? 'text-green-700' : accent === 'red' ? 'text-red-700' : 'text-black';
  return (
    <div
      className={`rounded-[12px] border border-black/8 bg-white px-3 py-2.5 ${
        fullWidth ? 'col-span-2' : ''
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">{label}</div>
      <div
        className={`mt-0.5 text-[13px] tracking-tighter break-all ${tone} ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
