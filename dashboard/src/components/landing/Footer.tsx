import Link from 'next/link';
import { ApertureLogo } from '../shared/ApertureLogo';

const footerLinks = [
  {
    label: 'X',
    href: 'https://x.com/aperturerwa',
    external: true,
  },
  {
    label: 'Docs',
    href: '/docs',
    external: false,
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative z-10 border-t border-amber-400/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-8">
          {/* Left - Logo and tagline */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <ApertureLogo />
            <p className="font-mono text-xs text-amber-400/60 max-w-xs text-center md:text-left">
              ZK compliance for AI agent payments
            </p>
          </div>

          {/* Center - Links */}
          <div className="flex items-center gap-6">
            {footerLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
                className="font-mono text-sm text-amber-400/60 hover:text-amber-400 transition-colors duration-200"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right - Built on Solana */}
          <div className="flex flex-col items-center md:items-end gap-2">
            <span className="font-mono text-xs text-amber-400/60">
              Built on Solana
            </span>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-8 pt-6 border-t border-amber-400/10 text-center">
          <p className="font-mono text-xs text-amber-400/50">
            {year} Aperture. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
