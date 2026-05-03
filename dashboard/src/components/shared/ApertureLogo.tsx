'use client';

import Image from 'next/image';

export function ApertureIcon({ size = 32 }: { size?: number }) {
  return (
    <Image
      src="/aperture.jpg"
      alt="Aperture"
      width={size}
      height={size}
      className="rounded-md"
    />
  );
}

export function ApertureLogo({ variant = 'auto', compact = false }: { variant?: 'auto' | 'dark' | 'light'; compact?: boolean }) {
  // All wordmarks are ink-black per the no-orange-text rule. The variant
  // prop is preserved for API compatibility but no longer changes color.
  void variant;

  return (
    <div className={`flex items-center ${compact ? 'gap-0.5' : 'gap-2.5'}`}>
      <ApertureIcon />
      <span className="text-[18px] font-medium tracking-tighter text-black">
        {compact ? 'perture' : 'Aperture'}
      </span>
    </div>
  );
}
