'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { config } from '@/lib/config';
import {
  Bot,
  AlertTriangle,
  X,
  Wallet,
  Activity,
  Zap,
  CreditCard,
  ShieldCheck,
  AlertOctagon,
} from 'lucide-react';
import { MetricCard } from './overview/MetricCard';
import { AgentControlCard } from './agents/AgentControlCard';
import {
  ActivityFeed,
  type ActivityRecord,
} from './agents/ActivityFeed';

const REFRESH_INTERVAL_MS = 5_000;

interface AgentStats {
  readonly totalX402: number;
  readonly totalMpp: number;
  readonly totalProofs: number;
  readonly totalViolations: number;
  readonly totalUsdcSpent: number;
  readonly totalMppSpent: number;
  readonly totalSessions: number;
}

interface AgentStatus {
  readonly running: boolean;
  readonly operatorId: string;
  readonly lastActivity: string | null;
  readonly stats: AgentStats;
}

export function AgentActivityTab() {
  const operatorId = useOperatorId();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [activity, setActivity] = useState<readonly ActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const prevIdsRef = useRef<ReadonlySet<string>>(new Set());

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, activityRes] = await Promise.all([
        fetch(`${config.agentServiceUrl}/status`),
        fetch(`${config.agentServiceUrl}/activity?limit=50`),
      ]);

      if (statusRes.ok) {
        setStatus(await statusRes.json());
      }

      if (activityRes.ok) {
        const body = (await activityRes.json()) as { data: ActivityRecord[] };
        const currentIds = new Set(body.data.map((r) => r.id));
        const fresh = new Set<string>();
        for (const id of currentIds) {
          if (!prevIdsRef.current.has(id)) fresh.add(id);
        }
        if (fresh.size > 0 && prevIdsRef.current.size > 0) setNewIds(fresh);
        prevIdsRef.current = currentIds;
        setActivity(body.data);
      }

      setError(null);
    } catch {
      setError('Agent service not reachable (port 3004)');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Clear highlight after 3s so freshly arrived rows fade back into the
  // normal feed style.
  useEffect(() => {
    if (newIds.size === 0) return;
    const timer = setTimeout(() => setNewIds(new Set()), 3000);
    return () => clearTimeout(timer);
  }, [newIds]);

  async function startAgent(): Promise<void> {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.agentServiceUrl}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Pass the connected wallet so agent-side DB records (proof_records,
        // attestations) are tagged with this operator_id and surface in the
        // dashboard's Compliance / Overview tabs which filter by operator_id.
        body: JSON.stringify({ operator_id: operatorId }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start agent');
    } finally {
      setActionLoading(false);
    }
  }

  async function stopAgent(): Promise<void> {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`${config.agentServiceUrl}/stop`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop agent');
    } finally {
      setActionLoading(false);
    }
  }

  if (!operatorId) {
    return (
      <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
          <Wallet className="h-6 w-6" />
        </span>
        <h2 className="font-display text-[24px] tracking-[-0.012em] text-black">
          Connect a wallet to view agent activity
        </h2>
        <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
          The autonomous agent loop is namespaced per operator wallet. Connect to start
          and monitor your agent.
        </p>
      </div>
    );
  }

  const isRunning = status?.running ?? false;
  const stats = status?.stats;

  return (
    <div className="space-y-6">
      <AgentControlCard
        running={isRunning}
        operatorId={operatorId}
        lastActivity={status?.lastActivity ?? null}
        actionLoading={actionLoading}
        onStart={startAgent}
        onStop={stopAgent}
      />

      {error && (
        <div className="ap-card p-4 flex items-center gap-3" style={{ borderColor: '#fca5a5' }}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-600" />
          <p className="text-[13px] text-red-700 tracking-tighter">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto flex-shrink-0 text-black/45 hover:text-black"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard
            label="Sessions"
            value={(stats?.totalSessions ?? 0).toLocaleString()}
            icon={Activity}
            hint="Lifetime — start/stop cycles"
          />
          <MetricCard
            label="x402 Settlements"
            value={(stats?.totalX402 ?? 0).toLocaleString()}
            icon={Zap}
            hint={`${(stats?.totalUsdcSpent ?? 0).toFixed(2)} USDC paid`}
          />
          <MetricCard
            label="MPP Settlements"
            value={(stats?.totalMpp ?? 0).toLocaleString()}
            icon={CreditCard}
            hint={`$${(stats?.totalMppSpent ?? 0).toFixed(2)} charged`}
          />
          <MetricCard
            label="ZK Proofs"
            value={(stats?.totalProofs ?? 0).toLocaleString()}
            icon={ShieldCheck}
            hint="Generated and verified on-chain"
          />
          <MetricCard
            label="Policy Violations"
            value={(stats?.totalViolations ?? 0).toLocaleString()}
            icon={AlertOctagon}
            hint="Blocked before settlement"
          />
        </section>
      )}

      <ActivityFeed records={activity} newIds={newIds} loading={loading} />

      {!loading && activity.length === 0 && !stats && (
        <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
            <Bot className="h-6 w-6" />
          </span>
          <h3 className="font-display text-[22px] tracking-[-0.005em] text-black">
            Agent service is offline
          </h3>
          <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
            Aperture couldn&apos;t reach the agent service on port 3004. Start
            <code className="mx-1 rounded bg-black/5 px-1 text-aperture-dark font-mono">
              npm run dev:agent
            </code>{' '}
            to enable the autonomous loop.
          </p>
        </div>
      )}
    </div>
  );
}
