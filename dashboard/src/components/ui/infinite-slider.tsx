'use client';

/**
 * InfiniteSlider — minimal CSS-keyframe horizontal marquee.
 * Pure CSS (no measuring), so it stays in sync across SSR/hydration.
 * Children are duplicated so the loop is seamless.
 */

import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface InfiniteSliderProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** Loop duration in seconds. Lower = faster. */
  readonly duration?: number;
  /** Pixel gap between items. */
  readonly gap?: number;
  /** Direction of motion. */
  readonly direction?: 'left' | 'right';
  /** Pause on hover. */
  readonly pauseOnHover?: boolean;
}

export function InfiniteSlider({
  children,
  className,
  duration = 30,
  gap = 48,
  direction = 'left',
  pauseOnHover = true,
}: InfiniteSliderProps) {
  // The `__infinite_slider_track` class lives in globals.css so we can keep
  // the keyframes outside of Tailwind's JIT.
  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{
        // Custom properties consumed by the CSS keyframes
        ['--slider-duration' as string]: `${duration}s`,
        ['--slider-gap' as string]: `${gap}px`,
        ['--slider-direction' as string]: direction === 'left' ? 'normal' : 'reverse',
      }}
    >
      <div
        className={cn(
          '__infinite_slider_track flex w-max items-center',
          pauseOnHover && 'hover:[animation-play-state:paused]',
        )}
        style={{ gap: `${gap}px` }}
      >
        {/* Render the set twice for a continuous loop */}
        <div className="flex shrink-0 items-center" style={{ gap: `${gap}px` }}>
          {children}
        </div>
        <div
          className="flex shrink-0 items-center"
          style={{ gap: `${gap}px` }}
          aria-hidden="true"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
