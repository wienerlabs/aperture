'use client';

/**
 * CopyableField — labelled monospace value + click-to-copy. Used liberally
 * in Settings (URLs, addresses, operator IDs) and AIP Agents (DIDs, public
 * keys). Antimetal styling: white surface, sharp 0px input radius, hover
 * border tint, copy state shows the green tick for 1.8s.
 */

import { useState, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CopyableFieldProps {
  readonly label: string;
  readonly value: string;
  /** Override how the value is rendered (e.g. truncate, link). Defaults to plain mono text. */
  readonly display?: ReactNode;
  readonly helper?: string;
  readonly className?: string;
}

export function CopyableField({
  label,
  value,
  display,
  helper,
  className,
}: CopyableFieldProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[11px] uppercase tracking-[0.08em] text-black/55">
        {label}
      </span>
      <div className="flex items-center gap-2 group">
        <div className="flex-1 min-w-0 px-3 py-2 bg-white border border-black/12 hover:border-aperture/40 transition-colors">
          <span className="text-[12px] font-mono text-black break-all">
            {display ?? value}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-pill text-black/55 hover:text-black hover:bg-black/5 transition-colors"
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {helper && (
        <span className="text-[12px] text-black/55 tracking-tighter">{helper}</span>
      )}
    </div>
  );
}
