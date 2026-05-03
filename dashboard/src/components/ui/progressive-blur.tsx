'use client';

/**
 * ProgressiveBlur — fades a horizontal edge of the parent into the page
 * background. Used at the left/right ends of the InfiniteSlider so logos
 * dissolve instead of hard-cutting.
 *
 * Implementation: a stack of backdrop-filter blur layers each masked by an
 * increasing alpha gradient — the layered approach gives the "progressive"
 * blur (light at the inner edge, opaque at the outer edge).
 */

import { cn } from '@/lib/utils';

interface ProgressiveBlurProps {
  readonly className?: string;
  readonly direction?: 'left' | 'right';
  /** Multiplier for blur intensity (1 = base scale). */
  readonly blurIntensity?: number;
}

const LAYER_COUNT = 6;

export function ProgressiveBlur({
  className,
  direction = 'left',
  blurIntensity = 1,
}: ProgressiveBlurProps) {
  return (
    <div className={cn('overflow-hidden', className)} aria-hidden="true">
      {Array.from({ length: LAYER_COUNT }).map((_, i) => {
        const t = (i + 1) / LAYER_COUNT; // 0 → 1
        const blurPx = Math.pow(2, i) * blurIntensity; // 1, 2, 4, 8, 16, 32
        const innerStop = (1 - t) * 100; // alpha gradient transition
        const gradient =
          direction === 'left'
            ? `linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) ${innerStop}%, rgba(0,0,0,0) 100%)`
            : `linear-gradient(to left,  rgba(0,0,0,1) 0%, rgba(0,0,0,1) ${innerStop}%, rgba(0,0,0,0) 100%)`;

        return (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${blurPx}px)`,
              WebkitBackdropFilter: `blur(${blurPx}px)`,
              maskImage: gradient,
              WebkitMaskImage: gradient,
            }}
          />
        );
      })}
    </div>
  );
}
