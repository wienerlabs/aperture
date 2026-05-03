'use client';

/**
 * EligibilityChecklist — small inline pill row that explains why a payment
 * action might be disabled. Each item is a "ready / pending / blocked"
 * pill; the disabled state of the parent button is justified visually.
 */

import { Check, X, Loader2 } from 'lucide-react';

export type EligibilityState = 'ready' | 'pending' | 'blocked';

interface CheckItem {
  readonly label: string;
  readonly state: EligibilityState;
  readonly hint?: string;
}

export function EligibilityChecklist({ items }: { items: readonly CheckItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {items.map((item) => (
        <li
          key={item.label}
          title={item.hint}
          className={`inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-[11px] font-medium tracking-tighter ${
            item.state === 'ready'
              ? 'bg-green-500/10 text-green-700'
              : item.state === 'pending'
                ? 'bg-aperture/15 text-aperture-dark'
                : 'bg-red-500/12 text-red-700'
          }`}
        >
          {item.state === 'ready' ? (
            <Check className="h-3 w-3" />
          ) : item.state === 'pending' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}
