'use client';

/**
 * AuditTrailTimeline — chronological strip of the most recent attestations,
 * collapsed into a vertical timeline. Useful as a "compliance pulse"
 * summary even when an operator already has a card grid below.
 */

import { Anchor, Clock } from 'lucide-react';
import { config as apertureConfig } from '@/lib/config';
import { formatDate, truncateAddress } from '@/lib/utils';
import type { Attestation } from '@/lib/api';

export function AuditTrailTimeline({
  attestations,
}: {
  attestations: readonly Attestation[];
}) {
  const items = attestations.slice(0, 6);
  if (items.length === 0) return null;

  return (
    <div className="ap-card p-5 sm:p-6 flex flex-col gap-4">
      <header>
        <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
          Audit Trail
        </h3>
        <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
          Most recent attestations, newest first.
        </p>
      </header>

      <ol className="relative flex flex-col gap-4 pl-6 before:absolute before:inset-y-1 before:left-2 before:w-px before:bg-black/10">
        {items.map((a) => {
          const anchored = Boolean(a.tx_signature);
          return (
            <li key={a.id} className="relative">
              <span
                className={`absolute -left-6 top-1 inline-flex h-5 w-5 items-center justify-center rounded-pill ring-4 ring-white ${
                  anchored ? 'bg-green-500/15 text-green-700' : 'bg-aperture/15 text-aperture-dark'
                }`}
              >
                {anchored ? <Anchor className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              </span>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="text-[13px] text-black tracking-tighter">
                  <span className="font-medium">
                    {formatDate(a.period_start)} – {formatDate(a.period_end)}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-black/55">
                    {truncateAddress(a.id, 6)}
                  </span>
                </div>
                {anchored && a.tx_signature ? (
                  <a
                    href={apertureConfig.txExplorerUrl(a.tx_signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-mono text-aperture-dark hover:text-black transition-colors"
                  >
                    {truncateAddress(a.tx_signature, 6)}
                  </a>
                ) : (
                  <span className="text-[11px] text-black/45">awaiting anchor</span>
                )}
              </div>
              <div className="text-[11px] text-black/55 tracking-tighter mt-0.5">
                {a.total_payments} payment{a.total_payments === 1 ? '' : 's'} ·{' '}
                {a.policy_violations} violation
                {a.policy_violations === 1 ? '' : 's'}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
