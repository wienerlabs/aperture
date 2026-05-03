'use client';

/**
 * NetworkStatusCard — pulls Solana RPC liveness, current slot, and the
 * three Aperture program IDs into a single Antimetal-style dashboard card.
 */

import { useEffect, useState } from 'react';
import { Connection } from '@solana/web3.js';
import { CircleDot, ExternalLink } from 'lucide-react';
import { config as apertureConfig } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';

interface NetworkSnapshot {
  readonly status: 'connecting' | 'healthy' | 'degraded';
  readonly slot: number | null;
  readonly version: string | null;
  readonly error: string | null;
}

const POLL_MS = 15_000;

export function NetworkStatusCard() {
  const [snap, setSnap] = useState<NetworkSnapshot>({
    status: 'connecting',
    slot: null,
    version: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let connection: Connection | null = null;

    async function tick() {
      try {
        if (!connection) connection = new Connection(apertureConfig.solanaRpcUrl, 'confirmed');
        const [slot, versionInfo] = await Promise.all([
          connection.getSlot('confirmed'),
          connection.getVersion(),
        ]);
        if (cancelled) return;
        setSnap({
          status: 'healthy',
          slot,
          version: versionInfo['solana-core'] ?? null,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setSnap((prev) => ({
          status: 'degraded',
          slot: prev.slot,
          version: prev.version,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const programs = [
    { label: 'Policy Registry', id: apertureConfig.programs.policyRegistry },
    { label: 'ZK Verifier', id: apertureConfig.programs.verifier },
    { label: 'Transfer Hook', id: apertureConfig.programs.transferHook },
  ];

  return (
    <div className="ap-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-[18px] leading-none tracking-[-0.005em] text-black">
            Network
          </h3>
          <p className="text-[12px] text-black/55 tracking-tighter mt-1">
            Solana Devnet RPC · refreshes every 15s
          </p>
        </div>
        <StatusPill status={snap.status} />
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Cell
          label="Current Slot"
          value={snap.slot != null ? snap.slot.toLocaleString() : '—'}
        />
        <Cell label="RPC Version" value={snap.version ?? '—'} />
      </dl>

      <div className="flex flex-col gap-2 mt-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-black/55">
          Devnet Programs
        </span>
        {programs.map((p) => (
          <a
            key={p.id}
            href={`https://explorer.solana.com/address/${p.id}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.04)] px-3 py-2 hover:bg-[rgba(248,179,0,0.08)] transition-colors"
          >
            <div className="flex flex-col">
              <span className="text-[13px] text-black tracking-tighter">{p.label}</span>
              <span className="text-[11px] font-mono text-black/55">
                {truncateAddress(p.id, 6)}
              </span>
            </div>
            <ExternalLink className="h-3.5 w-3.5 text-black/45" />
          </a>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: NetworkSnapshot['status'] }) {
  const config = {
    healthy: { label: 'Operational', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.12)' },
    connecting: { label: 'Connecting', color: '#c98f00', bg: 'rgba(248, 179, 0, 0.18)' },
    degraded: { label: 'Degraded', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.12)' },
  }[status];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-medium tracking-tighter"
      style={{ color: config.color, background: config.bg }}
    >
      <CircleDot className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">{label}</div>
      <div className="text-[14px] font-medium text-black tracking-tighter mt-0.5">
        {value}
      </div>
    </div>
  );
}
