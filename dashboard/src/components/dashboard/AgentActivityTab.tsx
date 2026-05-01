'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { config } from '@/lib/config';
import {
  Bot,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  Zap,
  ShieldCheck,
  FileText,
  Activity,
  Play,
  Square,
  AlertTriangle,
} from 'lucide-react';
import { truncateAddress } from '@/lib/utils';

const REFRESH_INTERVAL_MS = 5_000;

interface ActivityRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly type: 'x402' | 'mpp' | 'attestation' | 'policy_check' | 'zk_proof' | 'error';
  readonly message: string;
  readonly proofHash: string | null;
  readonly txSignature: string | null;
  readonly paymentIntentId: string | null;
  readonly success: boolean;
}

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

function formatTimeAgo(date: string): string {
  const diffSec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
}

function typeColor(type: ActivityRecord['type']): string {
  switch (type) {
    case 'x402': return 'bg-amber-400/10 text-amber-400';
    case 'mpp': return 'bg-purple-400/10 text-purple-400';
    case 'attestation': return 'bg-green-400/10 text-green-400';
    case 'zk_proof': return 'bg-blue-400/10 text-blue-400';
    case 'policy_check': return 'bg-amber-100/5 text-amber-100/50';
    case 'error': return 'bg-red-400/10 text-red-400';
    default: return 'bg-amber-100/5 text-amber-100/50';
  }
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
        const currentIds = new Set(body.data.map(r => r.id));
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

  // Clear highlight after 3s
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
      <div className="flex flex-col items-center justify-center py-20 text-amber-100/40">
        <Bot className="w-12 h-12 mb-4" />
        <p className="text-lg">Connect your wallet to view agent activity</p>
      </div>
    );
  }

  const isRunning = status?.running ?? false;
  const stats = status?.stats;

  return (
    <div className="space-y-6">
      {/* Header with Start/Stop */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-amber-100">Agent Activity</h2>
          <p className="text-amber-100/40 text-sm mt-1">
            Autonomous agent monitoring and control
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-400/10">
            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-amber-100/20'}`} />
            <span className={`text-xs font-medium ${isRunning ? 'text-green-400' : 'text-amber-100/40'}`}>
              {isRunning ? 'Agent Running' : 'Agent Idle'}
            </span>
          </div>

          {/* Start button */}
          {!isRunning && (
            <button
              onClick={startAgent}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                bg-green-500 text-white hover:bg-green-400
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Start Agent
            </button>
          )}

          {/* Stop button */}
          {isRunning && (
            <button
              onClick={stopAgent}
              disabled={actionLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                bg-red-500 text-white hover:bg-red-400
                disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
              Stop Agent
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-red-400/10 border border-red-400/20 text-red-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* Agent Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-amber-100/40">Sessions</span>
            </div>
            <p className="text-xl font-bold text-amber-100 font-mono">{stats?.totalSessions ?? 0}</p>
          </div>
          <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-amber-100/40">x402</span>
            </div>
            <p className="text-xl font-bold text-amber-100 font-mono">{stats?.totalX402 ?? 0}</p>
            <p className="text-xs text-amber-100/50 mt-0.5">{(stats?.totalUsdcSpent ?? 0).toFixed(2)} USDC</p>
          </div>
          <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-purple-400/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-amber-100/40">MPP</span>
            </div>
            <p className="text-xl font-bold text-amber-100 font-mono">{stats?.totalMpp ?? 0}</p>
            <p className="text-xs text-amber-100/50 mt-0.5">${(stats?.totalMppSpent ?? 0).toFixed(2)}</p>
          </div>
          <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-green-400/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <span className="text-xs text-amber-100/40">ZK Proofs</span>
            </div>
            <p className="text-xl font-bold text-amber-100 font-mono">{stats?.totalProofs ?? 0}</p>
          </div>
          <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-red-400/20 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-xs text-amber-100/40">Violations</span>
            </div>
            <p className="text-xl font-bold text-amber-100 font-mono">{stats?.totalViolations ?? 0}</p>
          </div>
        </div>
      )}

      {/* Live Activity Feed */}
      <div className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl">
        <div className="flex items-center justify-between p-4 border-b border-amber-400/10">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-100">Live Activity Feed</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-amber-100/50">Auto-refresh 5s</span>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-amber-400 animate-spin" />
          </div>
        )}

        {!loading && activity.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-amber-100/40">
            <Bot className="w-10 h-10 mb-3" />
            <p className="text-sm">No agent activity yet</p>
            <p className="text-xs mt-1">Click Start Agent to begin autonomous operations</p>
          </div>
        )}

        {!loading && activity.length > 0 && (
          <div className="divide-y divide-amber-400/5 max-h-[480px] overflow-y-auto">
            {activity.map((record) => {
              const isNew = newIds.has(record.id);

              return (
                <div
                  key={record.id}
                  className={`px-4 py-3 transition-all duration-700 ${
                    isNew ? 'bg-amber-400/10 border-l-2 border-amber-400' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${typeColor(record.type)}`}>
                        {record.type === 'zk_proof' ? 'ZK' : record.type === 'policy_check' ? 'POLICY' : record.type}
                      </span>

                      {record.success ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}

                      <span className="text-xs text-amber-100/70 max-w-[300px] truncate">
                        {record.message}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      {record.proofHash && (
                        <span className="font-mono text-xs text-amber-400/60">
                          {truncateAddress(record.proofHash, 6)}
                        </span>
                      )}

                      {record.txSignature && (
                        <a
                          href={config.txExplorerUrl(record.txSignature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-amber-400 hover:text-amber-300 text-xs"
                        >
                          <ExternalLink className="w-3 h-3" />
                          TX
                        </a>
                      )}

                      {record.paymentIntentId && !record.txSignature && (
                        <span className="font-mono text-xs text-purple-400/60">
                          {record.paymentIntentId.slice(0, 12)}...
                        </span>
                      )}

                      <span className="text-xs text-amber-100/50 w-16 text-right">
                        {formatTimeAgo(record.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
