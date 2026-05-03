'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

// PixelBlast renders a WebGL canvas — must be client-only.
const PixelBlast = dynamic(() => import('@/components/PixelBlast'), {
  ssr: false,
});

export function HeroSection() {
  return (
    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center overflow-hidden bg-white text-ink">
      {/* PixelBlast animated backdrop — orange pixels on the white hero */}
      <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden>
        <PixelBlast
          variant="square"
          pixelSize={4}
          color="#f8b300"
          patternScale={2.4}
          patternDensity={1.4}
          enableRipples
          rippleSpeed={0.35}
          rippleThickness={0.12}
          rippleIntensityScale={1.4}
          speed={0.6}
          transparent
          edgeFade={0.35}
          style={{ width: '100%', height: '100%' }}
        />
      </div>

      {/* Subtle behind-text vignette only — keeps headline crisp without
          fading the pattern at the edges. */}
      <div className="absolute inset-0 z-[1] bg-[radial-gradient(ellipse_50%_40%_at_center,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.18)_55%,rgba(255,255,255,0)_85%)] pointer-events-none" />

      <div className="relative z-10 max-w-page mx-auto px-6 lg:px-8 text-center">
        {/* Announcement pill — Antimetal pattern on white surface */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="inline-flex items-center gap-2 mb-8 rounded-pill bg-white px-3 py-1.5 text-[13px] tracking-tightest text-ink shadow-ap-announce"
        >
          <span className="rounded-pill bg-aperture text-white px-2 py-0.5 text-[11px] font-medium tracking-tightest">
            New
          </span>
          Atomic verify + transfer is live on Solana Devnet
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="font-display text-[40px] sm:text-[56px] md:text-[72px] lg:text-[88px] font-normal text-ink leading-[1.04] tracking-[-0.012em]"
        >
          Prove compliance.
          <br />
          Reveal nothing.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          className="mt-6 max-w-2xl mx-auto text-base sm:text-lg text-ink-slate font-sans tracking-tighter"
        >
          ZK-powered payment compliance for enterprise AI agents. x402 + MPP. Built on Solana.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          {/* Primary CTA: orange fill + white text — highest contrast on white */}
          <Link href="/auth/signup" className="ap-btn-orange">
            Get Started
          </Link>
          {/* Ghost CTA on white surface */}
          <Link href="/docs" className="ap-btn-ghost-light">
            Read Docs
          </Link>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown className="text-aperture-dark/70" size={28} />
        </motion.div>
      </motion.div>
    </section>
  );
}
