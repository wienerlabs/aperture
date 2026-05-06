'use client';

/**
 * ProofTrendCard - last-7-days proof volume sparkline.
 * Pure SVG, no chart library. Bars shaded with the brand orange.
 */

import { useMemo } from 'react';
import { Activity } from 'lucide-react';

interface ProofRecordLike {
  readonly created_at?: string;
  readonly is_compliant?: boolean;
}

export function ProofTrendCard({ proofs }: { proofs: readonly ProofRecordLike[] }) {
  const series = useMemo(() => buildDailySeries(proofs, 7), [proofs]);
  const max = Math.max(1, ...series.map((d) => d.count));

  const total = series.reduce((acc, d) => acc + d.count, 0);
  const compliant = series.reduce((acc, d) => acc + d.compliant, 0);
  const compliancePct = total > 0 ? Math.round((compliant / total) * 100) : 100;

  return (
    <div className="ap-card p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-[18px] leading-none tracking-[-0.005em] text-black">
            Proof Activity
          </h3>
          <p className="text-[12px] text-black/55 tracking-tighter mt-1">
            Last 7 days · {total} proof{total === 1 ? '' : 's'} · {compliancePct}% compliant
          </p>
        </div>
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
          <Activity className="h-4 w-4" />
        </span>
      </div>

      <div className="flex items-end gap-2 pt-2">
        {series.map((d) => {
          // Pixel-based heights are more robust than nested percentage
          // heights inside flex containers (some browsers compute the
          // intermediate flex-grown parent as 0px until paint, which left
          // the bars invisible at zero proofs/day). 140px tall canvas, bar
          // ranges from 4px (empty day) up to the full canvas at max.
          const CANVAS_PX = 140;
          const heightPx =
            d.count === 0 ? 4 : Math.max(8, Math.round((d.count / max) * CANVAS_PX));
          return (
            <div
              key={d.iso}
              className="flex-1 flex flex-col items-center gap-1.5 group"
              title={`${d.label}: ${d.count} proof${d.count === 1 ? '' : 's'}`}
            >
              <div
                className="w-full flex items-end"
                style={{ height: `${CANVAS_PX}px` }}
              >
                <div
                  className="w-full rounded-[4px] transition-all duration-300 group-hover:opacity-90"
                  style={{
                    height: `${heightPx}px`,
                    background:
                      d.count === 0
                        ? 'rgba(248, 179, 0, 0.18)'
                        : 'linear-gradient(180deg, #f8b300 0%, #c98f00 100%)',
                    boxShadow:
                      d.count > 0
                        ? '0 6px 12px -6px rgba(101, 69, 0, 0.45)'
                        : undefined,
                  }}
                />
              </div>
              <span className="text-[10px] uppercase tracking-[0.08em] text-black/55">
                {d.label}
              </span>
              {d.count > 0 && (
                <span className="text-[11px] font-mono text-aperture-dark leading-none">
                  {d.count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DayBucket {
  readonly iso: string; // YYYY-MM-DD
  readonly label: string; // 3-letter weekday
  readonly count: number;
  readonly compliant: number;
}

function localIsoDate(d: Date): string {
  // Build a YYYY-MM-DD string from the *local* calendar so timezone offsets
  // do not push today's proofs into a UTC bucket that lives outside the
  // 7-day window the chart renders.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDailySeries(
  proofs: readonly ProofRecordLike[],
  days: number,
): readonly DayBucket[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets: { iso: string; label: string; count: number; compliant: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.push({
      iso: localIsoDate(d),
      label: d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3),
      count: 0,
      compliant: 0,
    });
  }

  const indexByIso = new Map<string, number>();
  buckets.forEach((b, i) => indexByIso.set(b.iso, i));

  for (const p of proofs) {
    if (!p.created_at) continue;
    const iso = localIsoDate(new Date(p.created_at));
    const idx = indexByIso.get(iso);
    if (idx == null) continue;
    buckets[idx].count += 1;
    if (p.is_compliant !== false) buckets[idx].compliant += 1;
  }

  return buckets;
}
