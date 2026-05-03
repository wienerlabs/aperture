'use client';

/**
 * PaymentStatsRow — top-of-page metric row for the Payments tab. Mirrors
 * the Overview MetricCard look so the two pages feel coherent, but is tuned
 * for payment-specific KPIs:
 *   - total proof records (lifetime)
 *   - compliance rate (compliant / total)
 *   - sample throughput (proofs in the loaded window)
 *   - last tx timestamp
 */

import { useMemo } from 'react';
import { CheckCircle2, FileText, Activity, Timer } from 'lucide-react';
import type { ProofRecord } from '@/lib/api';
import { MetricCard } from '../overview/MetricCard';

export function PaymentStatsRow({ proofs }: { proofs: readonly ProofRecord[] }) {
  const stats = useMemo(() => {
    const total = proofs.length;
    const compliant = proofs.filter((p) => p.is_compliant).length;
    const rate = total > 0 ? Math.round((compliant / total) * 100) : 100;

    let last: Date | null = null;
    for (const p of proofs) {
      const at = p.verified_at ?? p.created_at;
      if (!at) continue;
      const d = new Date(at);
      if (!last || d > last) last = d;
    }

    return {
      total,
      compliant,
      rate,
      last,
    };
  }, [proofs]);

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard
        label="Proof Records"
        value={stats.total.toLocaleString()}
        icon={FileText}
        hint={`${stats.compliant} compliant`}
      />
      <MetricCard
        label="Compliance Rate"
        value={`${stats.rate}%`}
        icon={CheckCircle2}
        hint="Compliant proofs / total"
      />
      <MetricCard
        label="Active Window"
        value={stats.total > 0 ? `${Math.min(stats.total, 50)}` : '—'}
        icon={Activity}
        hint="Records loaded in this view"
      />
      <MetricCard
        label="Last Settlement"
        value={stats.last ? relativeTime(stats.last) : '—'}
        icon={Timer}
        hint={stats.last ? stats.last.toLocaleString() : 'No proofs yet'}
      />
    </section>
  );
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  return `${month}mo ago`;
}
