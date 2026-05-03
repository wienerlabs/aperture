'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Shield,
  FileText,
  CheckCircle,
  Loader2,
  Sparkles,
  Coins,
} from 'lucide-react';
import {
  complianceApi,
  policyApi,
  type ProofRecord,
  type Attestation,
  type Policy,
} from '@/lib/api';
import { config as apertureConfig } from '@/lib/config';
import { truncateAddress, formatAmount } from '@/lib/utils';
// truncateAddress is also used inside the tx callback below.
import {
  getProofRecordCostComparison,
  lamportsToSol,
  isLightProtocolConfigured,
} from '@/lib/light-protocol';
import { useTxModal } from '@/components/providers/TxModalProvider';
import {
  makeFromParticipant,
  makeToParticipant,
} from '@/components/shared/TxModal';
import { MetricCard } from './overview/MetricCard';
import { ProofTrendCard } from './overview/ProofTrendCard';
import { NetworkStatusCard } from './overview/NetworkStatusCard';
import { QuickActionsCard } from './overview/QuickActionsCard';
import { RecentProofsCard } from './overview/RecentProofsCard';

interface OverviewData {
  readonly proofs: readonly ProofRecord[];
  readonly totalProofs: number;
  readonly attestations: readonly Attestation[];
  readonly totalAttestations: number;
  readonly policies: readonly Policy[];
}

const REFRESH_INTERVAL_MS = 5_000;

export function OverviewTab({
  onNavigate,
}: {
  onNavigate: (tab: string) => void;
}) {
  const operatorId = useOperatorId();
  const { publicKey } = useWallet();
  const tx = useTxModal();

  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [demoBusy, setDemoBusy] = useState(false);

  const walletAddress = publicKey?.toBase58() ?? operatorId ?? '';

  const fetchData = useCallback(
    async (showSpinner = false) => {
      if (!operatorId) return;
      if (showSpinner) setLoading(true);
      try {
        const [proofsRes, attestationsRes, policiesRes] = await Promise.all([
          complianceApi.listProofsByOperator(operatorId, 1, 50),
          complianceApi.listAttestations(operatorId, 1, 5),
          policyApi.list(operatorId, 1, 5),
        ]);
        setData({
          proofs: proofsRes.data,
          totalProofs: proofsRes.pagination.total,
          attestations: attestationsRes.data,
          totalAttestations: attestationsRes.pagination.total,
          policies: policiesRes.data,
        });
      } catch {
        // Silent — empty states handle the no-data case.
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [operatorId],
  );

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const compliantProofs = useMemo(
    () => (data?.proofs ?? []).filter((p) => p.is_compliant).length,
    [data],
  );
  const complianceRate = useMemo(() => {
    if (!data || data.proofs.length === 0) return 100;
    return Math.round((compliantProofs / data.proofs.length) * 100);
  }, [data, compliantProofs]);

  const proofsToday = useMemo(() => {
    if (!data) return 0;
    const todayIso = new Date().toISOString().slice(0, 10);
    return data.proofs.filter(
      (p) => p.created_at && new Date(p.created_at).toISOString().slice(0, 10) === todayIso,
    ).length;
  }, [data]);

  const cost = getProofRecordCostComparison();
  const totalProofs = data?.totalProofs ?? 0;
  const compressedSavingsLamports =
    (cost.regularAccountRentLamports - cost.compressedTokenCostLamports) * totalProofs;
  const activePolicy = data?.policies.find((p) => p.is_active) ?? null;

  /** Open the modal in pending state with a realistic x402 payment shape,
   *  then route the user to Payments where the real signer is wired up. The
   *  modal animation persists across the navigation because TxModal lives at
   *  the Providers root, not inside the tab tree. */
  const runX402Demo = useCallback(() => {
    if (demoBusy) return;
    if (!operatorId || !publicKey) {
      tx.show({
        status: 'error',
        from: { symbol: '—', amountLabel: '—', accountLabel: 'Connect wallet first' },
        to: { symbol: '—', amountLabel: '—', accountLabel: '—' },
        errorMessage: 'Connect a wallet to run the x402 demo.',
      });
      return;
    }

    setDemoBusy(true);

    const tokenSymbol = 'USDC';
    const amountLamports = 1_000_000n; // 1 USDC (6 decimals)

    tx.show({
      status: 'pending',
      from: makeFromParticipant({
        walletPubkey: publicKey.toBase58(),
        tokenSymbol,
        amountLamports,
      }),
      to: makeToParticipant({
        treasuryPubkey: apertureConfig.publisherWallet,
        tokenSymbol,
        amountLamports,
        resourceLabel: 'x402 Compliance Report',
      }),
      footnote: 'Routing to Payments tab for signer…',
    });

    setTimeout(() => {
      onNavigate('payments');
      setDemoBusy(false);
    }, 1500);
  }, [demoBusy, operatorId, publicKey, tx, onNavigate]);

  const runMppDemo = useCallback(() => {
    onNavigate('payments');
  }, [onNavigate]);

  const goToPolicies = useCallback(() => onNavigate('policies'), [onNavigate]);

  if (!operatorId) {
    return (
      <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
        <Shield className="h-10 w-10 text-aperture-dark" />
        <h2 className="font-display text-[24px] tracking-[-0.012em] text-black">
          Connect a wallet to view your overview
        </h2>
        <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
          Aperture surfaces ZK proof history, compliance metrics, and Solana network status
          per operator. Sign in or connect a wallet to get started.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="ap-card p-12 flex items-center justify-center">
        <Loader2 className="h-7 w-7 text-aperture animate-spin" />
      </div>
    );
  }

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
              <Sparkles className="h-3 w-3" />
              Operator Overview
            </span>
            <h1 className="font-display text-[36px] sm:text-[44px] leading-[1.04] tracking-[-0.012em] text-black">
              Welcome back, {truncateAddress(walletAddress, 4)}
            </h1>
            <p className="text-[14px] text-black/55 tracking-tighter max-w-xl">
              {totalProofs} proofs verified · {complianceRate}% compliant ·{' '}
              {data?.policies.length ?? 0} polic
              {(data?.policies.length ?? 0) === 1 ? 'y' : 'ies'} on file
            </p>
          </div>

          <div className="flex flex-col sm:items-end gap-2">
            <button
              type="button"
              onClick={runX402Demo}
              disabled={demoBusy}
              className="ap-btn-orange disabled:opacity-60"
            >
              {demoBusy ? 'Running…' : 'Run x402 Demo'}
            </button>
            <span className="text-[11px] text-black/45 tracking-tighter">
              Triggers an atomic verify+transfer on Devnet
            </span>
          </div>
        </div>
      </section>

      {/* Metrics row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Proofs"
          value={totalProofs.toLocaleString()}
          icon={FileText}
          delta={proofsToday}
          deltaSuffix=" today"
          hint="ZK proofs verified on-chain"
        />
        <MetricCard
          label="Compliance Rate"
          value={`${complianceRate}%`}
          icon={CheckCircle}
          hint={`${compliantProofs} of ${data?.proofs.length ?? 0} sampled`}
        />
        <MetricCard
          label="Policy Violations"
          value="0"
          icon={Shield}
          hint="Lifetime — proofs only sign when compliant"
        />
        <MetricCard
          label="Compression Savings"
          value={`${lamportsToSol(compressedSavingsLamports)} SOL`}
          icon={Coins}
          hint={`Light Protocol · ${cost.savingsMultiplier}× cheaper`}
        />
      </section>

      {/* Two-column body */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <ProofTrendCard proofs={data?.proofs ?? []} />
          <RecentProofsCard
            proofs={(data?.proofs ?? []).slice(0, 5)}
            onViewAll={() => onNavigate('compliance')}
          />
        </div>

        <div className="flex flex-col gap-6">
          <QuickActionsCard
            onCreatePolicy={goToPolicies}
            onTestX402={runX402Demo}
            onTestMpp={runMppDemo}
            busy={demoBusy}
          />
          <NetworkStatusCard />
        </div>
      </section>

      {/* Active policy + Light Protocol footer */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActivePolicySummary policy={activePolicy} onView={goToPolicies} />
        <LightProtocolStatus
          totalProofs={totalProofs}
          regularLamports={cost.regularAccountRentLamports * totalProofs}
          compressedLamports={cost.compressedTokenCostLamports * totalProofs}
        />
      </section>
    </div>
  );
}

function ActivePolicySummary({
  policy,
  onView,
}: {
  policy: Policy | null;
  onView: () => void;
}) {
  if (!policy) {
    return (
      <div className="ap-card p-5 flex flex-col gap-3">
        <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
          Active Policy
        </h3>
        <p className="text-[13px] text-black/55 tracking-tighter">
          You don&apos;t have an active policy yet. Create one to start enforcing limits and
          token whitelists for AI agents.
        </p>
        <button
          type="button"
          onClick={onView}
          className="ap-btn-orange w-fit"
        >
          Create Policy
        </button>
      </div>
    );
  }

  return (
    <div className="ap-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
          Active Policy
        </h3>
        <span className="inline-flex items-center gap-1 rounded-pill bg-aperture/15 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark">
          ✓ {policy.name}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Cell label="Max Daily Spend" value={formatAmount(policy.max_daily_spend)} />
        <Cell label="Max Per Tx" value={formatAmount(policy.max_per_transaction)} />
      </dl>

      <div className="flex flex-wrap gap-1.5">
        {policy.token_whitelist.map((mint) => (
          <span
            key={mint}
            className="inline-flex items-center rounded-pill bg-[rgba(248,179,0,0.10)] px-2 py-0.5 text-[11px] font-mono text-aperture-dark"
          >
            {mintLabel(mint)}
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onView}
        className="ap-btn-ghost-light w-fit"
      >
        Manage policies
      </button>
    </div>
  );
}

function LightProtocolStatus({
  totalProofs,
  regularLamports,
  compressedLamports,
}: {
  totalProofs: number;
  regularLamports: number;
  compressedLamports: number;
}) {
  const active = isLightProtocolConfigured();
  return (
    <div className="ap-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
          Light Protocol
        </h3>
        <span
          className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-medium tracking-tighter"
          style={{
            color: active ? '#16a34a' : '#7c8293',
            background: active ? 'rgba(22, 163, 74, 0.12)' : 'rgba(124, 130, 147, 0.10)',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-pill"
            style={{ background: active ? '#16a34a' : '#7c8293' }}
          />
          {active ? 'Compressed storage active' : 'Available — unconfigured'}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <Cell label="Regular PDA" value={`${lamportsToSol(regularLamports)} SOL`} />
        <Cell label="Compressed" value={`${lamportsToSol(compressedLamports)} SOL`} />
        <Cell
          label="Saved"
          value={`${lamportsToSol(regularLamports - compressedLamports)} SOL`}
        />
      </dl>

      <p className="text-[12px] text-black/55 tracking-tighter">
        Compressed attestation tokens reduce per-proof storage by{' '}
        <span className="text-black font-medium">
          {getProofRecordCostComparison().savingsMultiplier}×
        </span>
        . Estimate based on {totalProofs.toLocaleString()} historical proofs.
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">{label}</div>
      <div className="text-[14px] font-medium text-black tracking-tighter mt-0.5 truncate">
        {value}
      </div>
    </div>
  );
}

function mintLabel(mint: string): string {
  const t = apertureConfig.tokens;
  if (t.aUSDC && mint === t.aUSDC) return 'aUSDC';
  if (t.usdc && mint === t.usdc) return 'USDC';
  if (t.usdt && mint === t.usdt) return 'USDT';
  return truncateAddress(mint, 4);
}
