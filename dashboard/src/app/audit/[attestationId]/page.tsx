'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Lock,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Shield,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { complianceApi, type Attestation, type ProofRecord } from '@/lib/api';
import { config } from '@/lib/config';
import { ApertureLogo } from '@/components/shared/ApertureLogo';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { MatrixRain } from '@/components/shared/MatrixRain';
import { formatAmount, formatDate, truncateAddress } from '@/lib/utils';

type AuditData =
  | { type: 'attestation'; data: Attestation }
  | { type: 'proof'; data: ProofRecord };

export default function AuditPage() {
  const params = useParams();
  const auditId = params.attestationId as string;

  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!auditId) return;
    setLoading(true);
    setError(null);
    try {
      // Try attestation first
      try {
        const response = await complianceApi.getAttestation(auditId);
        if (response.data) {
          setAuditData({ type: 'attestation', data: response.data });
          setLoading(false);
          return;
        }
      } catch {
        // Not an attestation, try proof
      }

      // Try proof record
      try {
        const response = await complianceApi.getProof(auditId);
        if (response.data) {
          setAuditData({ type: 'proof', data: response.data });
          setLoading(false);
          return;
        }
      } catch {
        // Not a proof either
      }

      setError('Record not found');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch audit data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [auditId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="relative min-h-screen bg-[#090600] text-amber-100">
      <MatrixRain />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 py-12">
        {/* Logo + Theme Toggle */}
        <div className="mb-8 flex items-center gap-4">
          <ApertureLogo />
          <ThemeToggle />
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-amber-400 animate-spin" />
            <p className="text-amber-100/50 text-sm">Loading audit data...</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="w-full max-w-lg">
            <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-red-400/20 rounded-xl p-8 text-center">
              <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-red-400 mb-2">Record Not Found</h2>
              <p className="text-amber-100/50 text-sm">
                The requested audit record could not be found. It may not exist or may have expired.
              </p>
              <p className="text-amber-100/30 text-xs mt-4 font-mono">ID: {truncateAddress(auditId, 8)}</p>
            </div>
          </div>
        )}

        {/* Proof Record */}
        {!loading && auditData?.type === 'proof' && (
          <ProofAuditView proof={auditData.data} />
        )}

        {/* Attestation Record */}
        {!loading && auditData?.type === 'attestation' && (
          <AttestationAuditView attestation={auditData.data} />
        )}
      </div>
    </div>
  );
}

function ProofAuditView({ proof }: { readonly proof: ProofRecord }) {
  const txSignature = proof.tx_signature ?? null;
  const isAipTask = proof.payment_id.startsWith('aip-');

  return (
    <div className="w-full max-w-lg">
      {/* Compliance Badge */}
      <div className="flex justify-center mb-6">
        <div className={`flex items-center gap-3 px-8 py-4 rounded-2xl border-2 ${
          proof.is_compliant
            ? 'bg-green-500/10 border-green-400/40'
            : 'bg-red-500/10 border-red-400/40'
        }`}>
          {proof.is_compliant ? (
            <CheckCircle className="w-8 h-8 text-green-400" />
          ) : (
            <XCircle className="w-8 h-8 text-red-400" />
          )}
          <span className={`text-3xl font-black tracking-wider ${
            proof.is_compliant ? 'text-green-400' : 'text-red-400'
          }`}>
            {proof.is_compliant ? 'COMPLIANT' : 'NON-COMPLIANT'}
          </span>
        </div>
      </div>

      {/* Card */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 border-b border-amber-400/10">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Shield className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold text-amber-100">
              {isAipTask ? 'AIP Agent Payment Proof' : 'Payment Compliance Proof'}
            </h1>
          </div>
          <p className="text-center text-amber-100/50 text-sm">
            Zero-knowledge proof of payment compliance
          </p>
        </div>

        {/* Data rows */}
        <div className="px-8 py-6 space-y-4">
          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Operator</span>
            <span className="text-sm font-mono text-amber-100 text-right max-w-[60%] break-all">
              {truncateAddress(proof.operator_id, 8)}
            </span>
          </div>

          {isAipTask && (
            <div className="flex justify-between items-start">
              <span className="text-sm text-amber-100/50">Source</span>
              <span className="text-sm font-medium text-blue-400">AIP Agent Task</span>
            </div>
          )}

          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Payment ID</span>
            <span className="text-sm font-mono text-amber-100 text-right max-w-[60%] break-all">
              {truncateAddress(proof.payment_id, 10)}
            </span>
          </div>

          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Verified At</span>
            <span className="text-sm text-amber-100">{formatDate(proof.verified_at)}</span>
          </div>

          <div className="h-px bg-amber-400/10" />

          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Amount Range (ZK)</span>
            <span className="text-sm font-mono text-amber-100">
              {formatAmount(proof.amount_range_min)} - {formatAmount(proof.amount_range_max)} USDC
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-amber-100/50">Token</span>
            <span className="px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 text-xs font-mono">
              {proof.token_mint === 'usdc' ? 'USDC' : truncateAddress(proof.token_mint, 4)}
            </span>
          </div>

          <div className="h-px bg-amber-400/10" />

          <div>
            <span className="text-sm text-amber-100/50 block mb-1">ZK Proof Hash</span>
            <p className="text-xs font-mono text-amber-400 break-all bg-amber-400/5 rounded-lg p-3 border border-amber-400/10">
              {proof.proof_hash}
            </p>
          </div>
        </div>

        {/* Privacy notice */}
        <div className="mx-8 mb-6 p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">Privacy Preserved</span>
          </div>
          <p className="text-xs text-amber-100/50">
            Exact payment amount, recipient address, and transaction details are hidden
            using zero-knowledge proofs. Only the compliance verdict and amount range are
            revealed in this audit record.
          </p>
        </div>

        {/* Action */}
        <div className="px-8 pb-8">
          {txSignature ? (
            <a
              href={config.txExplorerUrl(txSignature)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg px-6 py-3 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Verify on Solana
            </a>
          ) : (
            <div className="flex items-center justify-center gap-2 w-full bg-amber-500/30 text-amber-100/60 font-bold rounded-lg px-6 py-3 cursor-not-allowed">
              <ExternalLink className="w-4 h-4" />
              No on-chain transaction recorded
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-amber-100/30 text-xs mt-6">
        This is a publicly verifiable compliance proof generated by Aperture Protocol.
        The proof can be independently verified on the Solana blockchain.
      </p>
    </div>
  );
}

function AttestationAuditView({ attestation }: { readonly attestation: Attestation }) {
  const txSignature = attestation.tx_signature ?? null;

  return (
    <div className="w-full max-w-lg">
      {/* COMPLIANT Badge */}
      <div className="flex justify-center mb-6">
        <div className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-green-500/10 border-2 border-green-400/40">
          <CheckCircle className="w-8 h-8 text-green-400" />
          <span className="text-3xl font-black text-green-400 tracking-wider">COMPLIANT</span>
        </div>
      </div>

      {/* Card */}
      <div className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 border-b border-amber-400/10">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Shield className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold text-amber-100">Compliance Attestation</h1>
          </div>
          <p className="text-center text-amber-100/50 text-sm">
            Cryptographic proof of regulatory compliance
          </p>
        </div>

        {/* Data rows */}
        <div className="px-8 py-6 space-y-4">
          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Operator</span>
            <span className="text-sm font-mono text-amber-100 text-right max-w-[60%] break-all">
              {truncateAddress(attestation.operator_id, 8)}
            </span>
          </div>

          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Period Start</span>
            <span className="text-sm text-amber-100">{formatDate(attestation.period_start)}</span>
          </div>

          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Period End</span>
            <span className="text-sm text-amber-100">{formatDate(attestation.period_end)}</span>
          </div>

          <div className="h-px bg-amber-400/10" />

          <div className="flex justify-between items-center">
            <span className="text-sm text-amber-100/50">Total Payments</span>
            <span className="text-sm font-mono text-amber-100 font-medium">{attestation.total_payments}</span>
          </div>

          <div className="flex justify-between items-start">
            <span className="text-sm text-amber-100/50">Total Amount Range</span>
            <span className="text-sm font-mono text-amber-100">
              {formatAmount(attestation.total_amount_range_min)} - {formatAmount(attestation.total_amount_range_max)}
            </span>
          </div>

          <div className="h-px bg-amber-400/10" />

          <div className="flex justify-between items-center">
            <span className="text-sm text-amber-100/50">Policy Violations</span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-400/10 text-green-400 text-xs font-medium">
              <CheckCircle className="w-3 h-3" />
              {attestation.policy_violations}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-amber-100/50">Sanctions Intersections</span>
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-400/10 text-green-400 text-xs font-medium">
              <CheckCircle className="w-3 h-3" />
              {attestation.sanctions_intersections}
            </span>
          </div>

          <div className="h-px bg-amber-400/10" />

          <div>
            <span className="text-sm text-amber-100/50 block mb-1">Proof Hash</span>
            <p className="text-xs font-mono text-amber-400 break-all bg-amber-400/5 rounded-lg p-3 border border-amber-400/10">
              {attestation.batch_proof_hash}
            </p>
          </div>
        </div>

        {/* Privacy notice */}
        <div className="mx-8 mb-6 p-4 rounded-lg bg-amber-400/5 border border-amber-400/10">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-medium text-amber-400">Privacy Preserved</span>
          </div>
          <p className="text-xs text-amber-100/50">
            Details are cryptographically hidden using zero-knowledge proofs.
            Only aggregate compliance data is revealed in this attestation.
            Individual payment amounts, recipients, and sender identities remain private.
          </p>
        </div>

        {/* Action */}
        <div className="px-8 pb-8">
          {txSignature ? (
            <a
              href={config.txExplorerUrl(txSignature)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg px-6 py-3 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Verify on Solana
            </a>
          ) : (
            <div className="flex items-center justify-center gap-2 w-full bg-amber-500/30 text-amber-100/60 font-bold rounded-lg px-6 py-3 cursor-not-allowed">
              <ExternalLink className="w-4 h-4" />
              No on-chain transaction recorded
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-amber-100/30 text-xs mt-6">
        This is a publicly verifiable attestation generated by Aperture Protocol.
        The proof can be independently verified on the Solana blockchain.
      </p>
    </div>
  );
}
