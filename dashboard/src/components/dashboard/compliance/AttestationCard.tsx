'use client';

/**
 * AttestationCard — modern Antimetal replacement for the dark glass card
 * each batch attestation used to render in. Adds an explicit "anchored vs
 * off-chain" pill and a compact 4-cell data grid that mirrors the rest of
 * the dashboard surface language.
 */

import { useState } from 'react';
import {
  ShieldCheck,
  ExternalLink,
  Copy,
  Check,
  Anchor,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { config as apertureConfig } from '@/lib/config';
import { formatDate, formatAmount, truncateAddress } from '@/lib/utils';
import type { Attestation } from '@/lib/api';

interface AttestationCardProps {
  readonly attestation: Attestation;
  readonly onShareAudit: (id: string) => void;
  readonly copied: boolean;
}

export function AttestationCard({
  attestation,
  onShareAudit,
  copied,
}: AttestationCardProps) {
  const [hashCopied, setHashCopied] = useState(false);
  const isAnchored = Boolean(attestation.tx_signature);

  async function copyHash() {
    try {
      await navigator.clipboard.writeText(attestation.batch_proof_hash);
      setHashCopied(true);
      setTimeout(() => setHashCopied(false), 1800);
    } catch {
      /* noop */
    }
  }

  return (
    <article className="ap-card p-5 sm:p-6 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
              Batch Attestation
            </h3>
            <span className="font-mono text-[11px] text-black/55">
              {truncateAddress(attestation.id, 8)}
            </span>
          </div>
        </div>

        {isAnchored ? (
          <span className="inline-flex items-center gap-1 rounded-pill bg-green-500/10 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-green-700 shrink-0">
            <Anchor className="h-3 w-3" />
            Anchored
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-pill bg-aperture/15 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark shrink-0">
            <Clock className="h-3 w-3" />
            Off-chain
          </span>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-3">
        <Cell
          label="Period"
          value={`${formatDate(attestation.period_start)} – ${formatDate(attestation.period_end)}`}
        />
        <Cell
          label="Total Payments"
          value={String(attestation.total_payments)}
          mono
        />
        <Cell
          label="Amount Range"
          value={`${formatAmount(attestation.total_amount_range_min)} – ${formatAmount(
            attestation.total_amount_range_max,
          )}`}
          mono
        />
        <Cell
          label="Policy Violations"
          value={String(attestation.policy_violations)}
          mono
          accent={attestation.policy_violations === 0 ? 'green' : 'red'}
        />
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] uppercase tracking-[0.08em] text-black/55">
          Batch Proof Hash
        </span>
        <button
          type="button"
          onClick={copyHash}
          className="group flex items-center justify-between gap-2 rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.04)] px-3 py-2 text-left hover:border-aperture/35 transition-colors"
        >
          <span className="font-mono text-[11px] text-black break-all">
            {attestation.batch_proof_hash}
          </span>
          <span className="shrink-0 text-black/45 group-hover:text-black">
            {hashCopied ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </span>
        </button>
      </div>

      <footer className="flex flex-wrap items-center gap-2 pt-3 border-t border-black/8">
        {attestation.tx_signature ? (
          <a
            href={apertureConfig.txExplorerUrl(attestation.tx_signature)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-aperture-dark hover:border-aperture/40 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on Solana
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-pill border border-dashed border-black/15 px-3 py-1.5 text-[12px] font-medium tracking-tighter text-black/45">
            <AlertTriangle className="h-3.5 w-3.5" />
            Not yet anchored
          </span>
        )}
        <button
          type="button"
          onClick={() => onShareAudit(attestation.id)}
          className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-black hover:border-aperture/40 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-600" />
              <span className="text-green-700">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Share audit link
            </>
          )}
        </button>
      </footer>
    </article>
  );
}

function Cell({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: 'green' | 'red';
}) {
  const valueColor =
    accent === 'green'
      ? 'text-green-700'
      : accent === 'red'
        ? 'text-red-700'
        : 'text-black';
  return (
    <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">{label}</div>
      <div
        className={`mt-0.5 text-[14px] tracking-tighter ${valueColor} ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
