'use client';

/**
 * QuickActionsCard — Antimetal-style "fastlane" panel that exposes the
 * three actions an operator wants 90% of the time:
 *  1. Author a new policy
 *  2. Run the protected x402 demo (which fires the TxModal end-to-end)
 *  3. Open a paywalled MPP report
 */

import { type LucideIcon, FileText, Zap, Receipt, ArrowRight } from 'lucide-react';

interface ActionItem {
  readonly title: string;
  readonly subtitle: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

interface QuickActionsCardProps {
  readonly onCreatePolicy: () => void;
  readonly onTestX402: () => void;
  readonly onTestMpp: () => void;
  readonly busy?: boolean;
}

export function QuickActionsCard({
  onCreatePolicy,
  onTestX402,
  onTestMpp,
  busy = false,
}: QuickActionsCardProps) {
  const actions: readonly ActionItem[] = [
    {
      title: 'Create Policy',
      subtitle: 'Define spending limits, blocked addresses, allowed tokens',
      icon: FileText,
      onClick: onCreatePolicy,
    },
    {
      title: 'Run x402 Demo',
      subtitle: 'Fetches a paywalled report; signs the atomic verify+transfer tx',
      icon: Zap,
      onClick: onTestX402,
      disabled: busy,
    },
    {
      title: 'Trigger MPP Report',
      subtitle: 'Stripe PaymentIntent → Poseidon receipt → on-chain proof',
      icon: Receipt,
      onClick: onTestMpp,
      disabled: busy,
    },
  ];

  return (
    <div className="ap-card p-5 flex flex-col gap-4">
      <div>
        <h3 className="font-display text-[18px] leading-none tracking-[-0.005em] text-black">
          Quick Actions
        </h3>
        <p className="text-[12px] text-black/55 tracking-tighter mt-1">
          Common operator workflows
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <button
            key={action.title}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className="group flex items-center gap-3 rounded-[14px] border border-black/8 bg-white px-3 py-2.5 text-left transition-all hover:border-aperture/40 hover:shadow-[0_4px_12px_-6px_rgba(101,69,0,0.18)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark group-hover:bg-aperture/20 transition-colors">
              <action.icon className="h-4 w-4" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-medium text-black tracking-tighter">
                {action.title}
              </div>
              <div className="text-[12px] text-black/55 tracking-tighter truncate">
                {action.subtitle}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-black/35 group-hover:text-aperture-dark group-hover:translate-x-0.5 transition-all" />
          </button>
        ))}
      </div>
    </div>
  );
}
