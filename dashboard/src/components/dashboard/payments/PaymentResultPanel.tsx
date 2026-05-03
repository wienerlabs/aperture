'use client';

/**
 * PaymentResultPanel — shared success/failure summary surfaced inside the
 * x402 and MPP cards once a flow completes. Replaces the legacy "p4 rounded
 * bg-green-400/5" pile with a clean Antimetal data grid: 1px outer ring,
 * uppercase labels, monospace values, ExternalLink icons for explorers.
 */

import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ResultDetail {
  readonly label: string;
  readonly value: string;
  /** Optional: render the value as a link to an external explorer. */
  readonly href?: string;
  readonly mono?: boolean;
  readonly fullWidth?: boolean;
}

interface PaymentResultPanelProps {
  readonly status: 'success' | 'error';
  readonly title: string;
  readonly details?: readonly ResultDetail[];
  readonly errorMessage?: string;
  /** Optional extra body — typically the JSON response from a paywalled API. */
  readonly children?: React.ReactNode;
}

export function PaymentResultPanel({
  status,
  title,
  details,
  errorMessage,
  children,
}: PaymentResultPanelProps) {
  const isSuccess = status === 'success';
  return (
    <div
      className={cn(
        'rounded-[16px] border bg-white p-4 flex flex-col gap-3',
        isSuccess ? 'border-green-500/25' : 'border-red-500/30',
      )}
    >
      <header className="flex items-center gap-2">
        {isSuccess ? (
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-red-600" />
        )}
        <span
          className={cn(
            'text-[13px] font-medium tracking-tighter',
            isSuccess ? 'text-green-700' : 'text-red-700',
          )}
        >
          {title}
        </span>
      </header>

      {details && details.length > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          {details.map((d) => (
            <div
              key={d.label}
              className={cn(
                'rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-2',
                d.fullWidth && 'col-span-2',
              )}
            >
              <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
                {d.label}
              </div>
              <div
                className={cn(
                  'mt-0.5 text-[13px] text-black tracking-tighter break-all',
                  d.mono && 'font-mono',
                )}
              >
                {d.href ? (
                  <a
                    href={d.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
                  >
                    {d.value}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  d.value
                )}
              </div>
            </div>
          ))}
        </dl>
      )}

      {errorMessage && (
        <pre className="text-[11px] font-mono text-red-700/85 whitespace-pre-wrap break-words bg-red-500/5 rounded-[8px] p-3 border border-red-500/15">
          {errorMessage}
        </pre>
      )}

      {children}
    </div>
  );
}
