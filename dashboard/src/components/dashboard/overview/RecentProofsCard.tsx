'use client';

/**
 * RecentProofsCard — minimal Antimetal table for the latest 5 proofs.
 * Replaces the legacy dark-theme list with a white surface, ink text,
 * and a subtle status pill instead of color-coded blobs.
 */

import { ArrowRight, ExternalLink } from 'lucide-react';
import { config as apertureConfig } from '@/lib/config';
import { truncateAddress, formatAmount, formatDate } from '@/lib/utils';
import type { ProofRecord } from '@/lib/api';

interface RecentProofsCardProps {
  readonly proofs: readonly ProofRecord[];
  readonly onViewAll: () => void;
}

export function RecentProofsCard({ proofs, onViewAll }: RecentProofsCardProps) {
  return (
    <div className="ap-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-[18px] leading-none tracking-[-0.005em] text-black">
            Recent Proofs
          </h3>
          <p className="text-[12px] text-black/55 tracking-tighter mt-1">
            Latest verifications recorded on-chain
          </p>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex items-center gap-1 text-[12px] tracking-tighter text-black/65 hover:text-black transition-colors"
        >
          View all
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {proofs.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-black/12 bg-[rgba(248,179,0,0.03)] px-4 py-8 text-center">
          <p className="text-[13px] text-black/55 tracking-tighter">
            No proofs yet. Run the x402 demo to generate your first ZK proof.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-black/8">
          {proofs.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium tracking-tighter ${
                    p.is_compliant
                      ? 'bg-aperture/15 text-aperture-dark'
                      : 'bg-red-500/12 text-red-700'
                  }`}
                >
                  {p.is_compliant ? '✓ Compliant' : '✗ Rejected'}
                </span>
                <span className="font-mono text-[12px] text-black/65 truncate">
                  {truncateAddress(p.proof_hash, 5)}
                </span>
                <span className="text-[12px] text-black/55 hidden sm:inline tracking-tighter">
                  {formatAmount(p.amount_range_min)}–{formatAmount(p.amount_range_max)}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] text-black/45 tracking-tighter hidden md:inline">
                  {p.created_at ? formatDate(p.created_at) : ''}
                </span>
                {p.tx_signature && (
                  <a
                    href={apertureConfig.txExplorerUrl(p.tx_signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-black/45 hover:text-black transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
