'use client';

/**
 * AgentControlCard — hero-level control surface for the autonomous agent.
 * Big radial-glow status dot, run/stop CTA, and a compact metadata row
 * (operator, last activity, refresh cadence).
 */

import { Loader2, Play, Square, Bot, Activity } from 'lucide-react';
import { truncateAddress } from '@/lib/utils';

interface AgentControlCardProps {
  readonly running: boolean;
  readonly operatorId: string;
  readonly lastActivity: string | null;
  readonly actionLoading: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
}

export function AgentControlCard({
  running,
  operatorId,
  lastActivity,
  actionLoading,
  onStart,
  onStop,
}: AgentControlCardProps) {
  return (
    <section
      className="relative overflow-hidden rounded-[24px] border border-black/8 bg-white p-6 sm:p-7"
      style={{ boxShadow: 'var(--shadow-card)' }}
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: running
            ? 'radial-gradient(ellipse 40% 60% at 95% 0%, rgba(22,163,74,0.18) 0%, rgba(22,163,74,0) 65%)'
            : 'radial-gradient(ellipse 50% 80% at 95% 10%, rgba(248,179,0,0.16) 0%, rgba(248,179,0,0) 65%)',
        }}
      />

      <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="flex items-start gap-4">
          <span
            className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-pill"
            style={{
              background: running ? 'rgba(22,163,74,0.12)' : 'rgba(248, 179, 0, 0.14)',
              color: running ? '#16a34a' : '#c98f00',
            }}
          >
            <Bot className="h-5 w-5" />
            {running && (
              <span className="absolute inset-0 rounded-pill animate-ping opacity-50 bg-green-500/15" />
            )}
          </span>

          <div className="flex flex-col gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-aperture/15 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark w-fit">
              <Activity className="h-3 w-3" />
              Agent Activity
            </span>
            <h1 className="font-display text-[30px] sm:text-[36px] leading-[1.04] tracking-[-0.012em] text-black">
              {running ? 'Agent is running' : 'Agent is idle'}
            </h1>
            <p className="text-[13px] text-black/55 tracking-tighter max-w-2xl">
              Operator <span className="font-mono text-black/75">{truncateAddress(operatorId, 6)}</span>
              {lastActivity && (
                <>
                  {' '}
                  · Last activity{' '}
                  <span className="text-black/75">{relativeTime(lastActivity)}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-medium tracking-tighter"
            style={{
              color: running ? '#16a34a' : '#7c8293',
              background: running ? 'rgba(22, 163, 74, 0.12)' : 'rgba(124, 130, 147, 0.10)',
            }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-pill ${running ? 'animate-pulse' : ''}`}
              style={{ background: running ? '#16a34a' : '#7c8293' }}
            />
            {running ? 'Running' : 'Idle'}
          </span>

          {!running ? (
            <button
              onClick={onStart}
              disabled={actionLoading}
              className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Start Agent
            </button>
          ) : (
            <button
              onClick={onStop}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-pill border border-red-500/30 bg-red-500/8 px-4 h-10 text-[15px] font-medium tracking-tighter text-red-700 hover:bg-red-500/12 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Stop Agent
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function relativeTime(date: string): string {
  const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(date).toLocaleString();
}
