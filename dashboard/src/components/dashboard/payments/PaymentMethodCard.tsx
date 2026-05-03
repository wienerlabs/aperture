'use client';

/**
 * PaymentMethodCard — chrome for the x402 / MPP / Transfer Hook flows.
 * Each card carries:
 *   - title + subtitle + brand-coloured icon pill
 *   - protocol shape (FlowDiagram)
 *   - eligibility checklist (why CTA might be disabled)
 *   - the children slot (per-protocol UI: stripe element, result panel, ...)
 *   - the primary CTA, slotted as a button-shaped child
 */

import { type LucideIcon, type ReactNode } from 'react';
import { FlowDiagram } from './FlowDiagram';
import { EligibilityChecklist, type EligibilityState } from './EligibilityChecklist';
import {
  ProtocolBadgeRow,
  type ProtocolId,
} from '@/components/shared/ProtocolBadge';

interface PaymentMethodCardProps {
  readonly title: string;
  readonly subtitle: string;
  readonly badge?: string;
  readonly icon: LucideIcon;
  readonly variant: 'x402' | 'mpp' | 'hook';
  readonly accent: 'orange' | 'navy';
  readonly action: ReactNode;
  readonly checklist?: readonly { label: string; state: EligibilityState; hint?: string }[];
  /**
   * "Powered by" partner protocol logos shown under the headline. Rendered
   * as quiet, opacity-55, brightness(0) wordmarks so they don't fight with
   * the brand orange.
   */
  readonly protocols?: readonly ProtocolId[];
  readonly children?: ReactNode;
}

const ACCENT_RING: Record<PaymentMethodCardProps['accent'], string> = {
  orange: 'rgba(248,179,0,0.35)',
  navy: 'rgba(26,26,26,0.18)',
};

export function PaymentMethodCard({
  title,
  subtitle,
  badge,
  icon: Icon,
  variant,
  accent,
  action,
  checklist,
  protocols,
  children,
}: PaymentMethodCardProps) {
  return (
    <div
      className="ap-card p-6 flex flex-col gap-5 relative overflow-hidden"
      style={{
        // Soft accent halo at top-right corner of each card.
        backgroundImage: `radial-gradient(ellipse 30% 50% at 100% 0%, ${ACCENT_RING[accent]} 0%, transparent 65%)`,
      }}
    >
      <header className="flex items-start gap-4">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-pill"
          style={{
            background: 'rgba(248, 179, 0, 0.12)',
            color: '#c98f00',
          }}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-[20px] tracking-[-0.005em] text-black">
              {title}
            </h3>
            {badge && (
              <span className="inline-flex items-center rounded-pill bg-aperture/15 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-aperture-dark">
                {badge}
              </span>
            )}
          </div>
          <p className="text-[13px] text-black/55 tracking-tighter mt-0.5">
            {subtitle}
          </p>
          {protocols && protocols.length > 0 && (
            <ProtocolBadgeRow protocols={protocols} className="mt-2.5" />
          )}
        </div>
      </header>

      {variant !== 'hook' && (
        <div className="rounded-[16px] border border-black/8 bg-[rgba(248,179,0,0.03)] p-3.5">
          <FlowDiagram variant={variant} />
        </div>
      )}

      {checklist && checklist.length > 0 && (
        <EligibilityChecklist items={checklist} />
      )}

      {children}

      <div className="flex">{action}</div>
    </div>
  );
}
