'use client';

/**
 * SettingsSection — Antimetal section card used by SettingsTab. Replaces
 * the legacy `bg-[rgba(10,10,10,0.8)] backdrop-blur-md` wrapper with our
 * white ap-card + an icon pill in the header.
 */

import { type LucideIcon, type ReactNode } from 'react';

interface SettingsSectionProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function SettingsSection({
  icon: Icon,
  title,
  description,
  action,
  children,
}: SettingsSectionProps) {
  return (
    <section className="ap-card p-6 sm:p-7 flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-[20px] tracking-[-0.005em] text-black">
              {title}
            </h3>
            {description && (
              <p className="text-[13px] text-black/55 tracking-tighter mt-0.5">
                {description}
              </p>
            )}
          </div>
        </div>
        {action}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
