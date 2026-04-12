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
  const textClass = variant === 'light'
    ? 'text-black'
    : variant === 'dark'
    ? 'text-[#f8b300]'
    : 'text-[#f8b300]';

  return (
    <div className={`flex items-center ${compact ? 'gap-0.5' : 'gap-2.5'}`}>
      <ApertureIcon />
      <span className={`text-lg font-bold tracking-wide ${textClass}`}>
        {compact ? 'perture' : 'Aperture'}
      </span>
    </div>
  );
}
