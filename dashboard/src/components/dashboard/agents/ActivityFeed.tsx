'use client';

/**
 * ActivityFeed — modern Antimetal feed for the agent's most recent
 * activity. Replaces the dark-theme list with white surface, type pills
 * coloured per event class, and a fresh-record highlight that fades after
 * the first paint.
 */

import {
  Bot,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  Zap,
  ShieldCheck,
  FileText,
  AlertOctagon,
} from 'lucide-react';
import { config as apertureConfig } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';

export type ActivityType =
  | 'x402'
  | 'mpp'
  | 'attestation'
  | 'policy_check'
  | 'zk_proof'
  | 'error';

export interface ActivityRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly type: ActivityType;
  readonly message: string;
  readonly proofHash: string | null;
  readonly txSignature: string | null;
  readonly paymentIntentId: string | null;
  readonly success: boolean;
}

interface ActivityFeedProps {
  readonly records: readonly ActivityRecord[];
  readonly newIds: ReadonlySet<string>;
  readonly loading: boolean;
}

export function ActivityFeed({ records, newIds, loading }: ActivityFeedProps) {
  return (
    <section className="ap-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-black/8">
        <div className="flex items-center gap-2.5">
          <FileText className="h-4 w-4 text-aperture-dark" />
          <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
            Live Activity Feed
          </h3>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-black/55 tracking-tighter">
          <span className="h-1.5 w-1.5 rounded-pill bg-green-500 animate-pulse" />
          Auto-refresh 5s
        </div>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 text-aperture animate-spin" />
        </div>
      )}

      {!loading && records.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
            <Bot className="h-5 w-5" />
          </span>
          <p className="text-[14px] tracking-tighter text-black">
            No agent activity yet
          </p>
          <p className="text-[12px] text-black/55 tracking-tighter">
            Click <span className="text-black">Start Agent</span> to begin autonomous operations.
          </p>
        </div>
      )}

      {!loading && records.length > 0 && (
        <ol className="divide-y divide-black/8 max-h-[520px] overflow-y-auto">
          {records.map((record) => {
            const isNew = newIds.has(record.id);
            return (
              <li
                key={record.id}
                className={`px-5 py-3 transition-colors ${
                  isNew ? 'bg-[rgba(248,179,0,0.06)]' : 'hover:bg-[rgba(248,179,0,0.03)]'
                }`}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <TypePill type={record.type} />

                    {record.success ? (
                      <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />
                    )}

                    <span className="text-[13px] tracking-tighter text-black truncate min-w-0">
                      {record.message}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {record.proofHash && (
                      <span className="font-mono text-[11px] text-aperture-dark">
                        {truncateAddress(record.proofHash, 5)}
                      </span>
                    )}

                    {record.txSignature && (
                      <a
                        href={apertureConfig.txExplorerUrl(record.txSignature)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-aperture-dark hover:text-black transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        TX
                      </a>
                    )}

                    {record.paymentIntentId && !record.txSignature && (
                      <span className="font-mono text-[11px] text-black/55">
                        {record.paymentIntentId.slice(0, 12)}…
                      </span>
                    )}

                    <span className="text-[11px] tracking-tighter text-black/55 w-16 text-right">
                      {relativeTime(record.timestamp)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function TypePill({ type }: { type: ActivityType }) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em]"
      style={{ background: meta.bg, color: meta.fg }}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

const TYPE_META: Record<
  ActivityType,
  { label: string; icon: typeof Zap; bg: string; fg: string }
> = {
  x402: { label: 'x402', icon: Zap, bg: 'rgba(248, 179, 0, 0.15)', fg: '#c98f00' },
  mpp: {
    label: 'MPP',
    icon: ShieldCheck,
    bg: 'rgba(124, 58, 237, 0.12)',
    fg: '#7c3aed',
  },
  attestation: {
    label: 'attest',
    icon: ShieldCheck,
    bg: 'rgba(22, 163, 74, 0.12)',
    fg: '#16a34a',
  },
  zk_proof: {
    label: 'ZK',
    icon: ShieldCheck,
    bg: 'rgba(8, 145, 178, 0.12)',
    fg: '#0891b2',
  },
  policy_check: {
    label: 'policy',
    icon: FileText,
    bg: 'rgba(124, 130, 147, 0.10)',
    fg: '#596075',
  },
  error: {
    label: 'error',
    icon: AlertOctagon,
    bg: 'rgba(220, 38, 38, 0.12)',
    fg: '#dc2626',
  },
};

function relativeTime(date: string): string {
  const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return new Date(date).toLocaleDateString();
}
