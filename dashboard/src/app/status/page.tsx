'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, XCircle } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

type Status = 'operational' | 'degraded' | 'down' | 'unconfigured';

interface Probe {
  readonly name: string;
  readonly category: 'service' | 'rpc';
  readonly status: Status;
  readonly latencyMs: number | null;
  readonly message: string | null;
  readonly checkedAt: string;
}

interface StatusResponse {
  readonly overall: Status;
  readonly probes: readonly Probe[];
  readonly generatedAt: string;
}

const POLL_INTERVAL_MS = 10_000;

function StatusPill({ status }: { status: Status }) {
  if (status === 'operational') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Operational
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        Degraded
      </span>
    );
  }
  if (status === 'down') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/10 border border-red-500/30 text-red-300">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Down
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-500/10 border border-zinc-500/30 text-zinc-400">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
      Not configured
    </span>
  );
}

function statusIcon(status: Status): JSX.Element {
  if (status === 'operational') return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
  if (status === 'degraded') return <AlertTriangle className="w-5 h-5 text-amber-400" />;
  if (status === 'down') return <XCircle className="w-5 h-5 text-red-400" />;
  return <CircleSlash className="w-5 h-5 text-zinc-500" />;
}

function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatTimeAgo(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

function OverallBanner({ status, generatedAt, now }: { status: Status; generatedAt: string | null; now: number }) {
  if (status === 'down') {
    return (
      <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-4 flex items-start gap-3">
        <XCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-mono text-sm font-semibold text-red-300">Active incident — one or more components are down</p>
          {generatedAt && <p className="text-xs text-red-300/60 mt-1">Last checked {formatTimeAgo(generatedAt, now)}</p>}
        </div>
      </div>
    );
  }
  if (status === 'degraded') {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-5 py-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-mono text-sm font-semibold text-amber-300">Degraded performance detected on one or more components</p>
          {generatedAt && <p className="text-xs text-amber-300/60 mt-1">Last checked {formatTimeAgo(generatedAt, now)}</p>}
        </div>
      </div>
    );
  }
  if (status === 'operational') {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-5 py-4 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-mono text-sm font-semibold text-emerald-300">All systems operational</p>
          {generatedAt && <p className="text-xs text-emerald-300/60 mt-1">Last checked {formatTimeAgo(generatedAt, now)}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-500/30 bg-zinc-500/5 px-5 py-4 flex items-start gap-3">
      <Loader2 className="w-5 h-5 text-zinc-400 mt-0.5 flex-shrink-0 animate-spin" />
      <p className="font-mono text-sm font-semibold text-zinc-300">Checking status…</p>
    </div>
  );
}

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const pollingRef = useRef<boolean>(false);

  const fetchStatus = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await fetch('/api/status/ping', { cache: 'no-store' });
      if (!res.ok) {
        setFetchError(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as StatusResponse;
      setData(body);
      setFetchError(null);
    } catch (err: unknown) {
      setFetchError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setLoading(false);
      pollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const { services, rpcs } = useMemo(() => {
    const s: Probe[] = [];
    const r: Probe[] = [];
    for (const p of data?.probes ?? []) {
      if (p.category === 'service') s.push(p);
      else r.push(p);
    }
    return { services: s, rpcs: r };
  }, [data]);

  return (
    <main className="relative min-h-screen bg-[#090600] flex flex-col">
      <Navbar />

      <section className="relative z-10 flex-1 pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 mb-2">Status</h1>
            <p className="text-sm text-amber-400/70">Live health of Aperture components, polled every 10 seconds.</p>
          </div>

          <div className="mb-8">
            <OverallBanner
              status={data?.overall ?? (loading ? 'unconfigured' : 'down')}
              generatedAt={data?.generatedAt ?? null}
              now={now}
            />
          </div>

          {fetchError && (
            <div className="mb-8 rounded-lg border border-red-500/40 bg-red-500/10 px-5 py-3 font-mono text-xs text-red-300">
              Status endpoint error: {fetchError}
            </div>
          )}

          <StatusGroup title="Services" probes={services} now={now} />
          <StatusGroup title="RPC endpoints" probes={rpcs} now={now} />

          <p className="mt-10 text-center text-[11px] font-mono text-amber-400/50">
            Auto-refresh every {POLL_INTERVAL_MS / 1000}s · Server-to-server probes via /api/status/ping
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function StatusGroup({ title, probes, now }: { title: string; probes: readonly Probe[]; now: number }) {
  if (probes.length === 0) return null;
  return (
    <div className="mb-10">
      <h2 className="font-mono text-sm uppercase tracking-[0.2em] text-amber-400/70 mb-4">{title}</h2>
      <div className="rounded-lg border border-amber-400/10 overflow-hidden">
        {probes.map((probe, idx) => (
          <div
            key={probe.name}
            className={`flex items-center gap-4 px-5 py-4 ${idx > 0 ? 'border-t border-amber-400/10' : ''}`}
          >
            <div className="flex-shrink-0">{statusIcon(probe.status)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="font-mono text-sm text-amber-100">{probe.name}</p>
                <StatusPill status={probe.status} />
              </div>
              {probe.message && (
                <p className="mt-1 text-xs text-amber-400/70 truncate">{probe.message}</p>
              )}
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="font-mono text-sm text-amber-200">{formatLatency(probe.latencyMs)}</p>
              <p className="text-[11px] font-mono text-amber-400/60 mt-0.5">
                {probe.status === 'unconfigured' ? '—' : formatTimeAgo(probe.checkedAt, now)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
