'use client';

import { type LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly hint?: string;
  readonly icon?: LucideIcon;
  /** Positive numbers render orange + up arrow; negative render gray + down arrow. */
  readonly delta?: number;
  /** Optional suffix appended to delta (e.g. "%" or " today"). */
  readonly deltaSuffix?: string;
  readonly className?: string;
}

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  deltaSuffix = '',
  className,
}: MetricCardProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const isPositive = hasDelta && (delta as number) >= 0;

  return (
    <div
      className={cn(
        'ap-card p-5 flex flex-col gap-3 transition-transform duration-200 hover:-translate-y-0.5',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] uppercase tracking-[0.08em] text-black/55">
          {label}
        </span>
        {Icon && (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-display text-[34px] leading-none tracking-[-0.012em] text-black">
          {value}
        </span>
        {hasDelta && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-[12px] font-medium tracking-tighter',
              isPositive ? 'text-aperture-dark' : 'text-black/55',
            )}
          >
            {isPositive ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(delta as number)}
            {deltaSuffix}
          </span>
        )}
      </div>

      {hint && (
        <span className="text-[12px] text-black/55 tracking-tighter">
          {hint}
        </span>
      )}
    </div>
  );
}
