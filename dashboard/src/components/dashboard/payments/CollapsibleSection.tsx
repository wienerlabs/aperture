'use client';

/**
 * CollapsibleSection — Antimetal-styled accordion used by Transfer Hook
 * Test and ZK Compression Cost Savings panels. White card surface, ink
 * label, optional chevron rotates on open.
 */

import { type LucideIcon, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface CollapsibleSectionProps {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly subtitle?: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}

export function CollapsibleSection({
  icon: Icon,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <section className="ap-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-[rgba(248,179,0,0.03)] transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-[14px] font-medium tracking-tighter text-black">
              {title}
            </div>
            {subtitle && (
              <div className="text-[12px] text-black/55 tracking-tighter truncate">
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-black/45 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pt-0 border-t border-black/8 bg-[rgba(248,179,0,0.02)]">
          <div className="pt-4">{children}</div>
        </div>
      )}
    </section>
  );
}
