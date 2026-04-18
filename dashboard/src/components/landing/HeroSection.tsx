'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

export function HeroSection() {
  return (
    <section className="relative z-10 min-h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* Subtle radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.08)_0%,transparent_70%)]" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="font-mono text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-amber-400 leading-tight tracking-tight"
        >
          Prove compliance.
          <br />
          Reveal nothing.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          className="mt-6 max-w-2xl mx-auto text-base sm:text-lg text-amber-400/50 font-mono"
        >
          ZK-powered payment compliance for enterprise AI agents. x402 + MPP. Built on Solana.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: 'easeOut' }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link
            href="/auth/signup"
            className="font-mono text-sm px-8 py-3 bg-amber-400 text-[#000000] rounded-lg font-semibold hover:bg-amber-300 transition-colors duration-200 shadow-[0_0_30px_rgba(245,158,11,0.15)]"
          >
            Get Started
          </Link>
          <Link
            href="/docs"
            className="font-mono text-sm px-8 py-3 border border-amber-400/20 text-amber-400 rounded-lg hover:border-amber-400/40 hover:bg-amber-400/5 transition-all duration-200"
          >
            Read Docs
          </Link>
        </motion.div>
      </div>

      {/* Scroll indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          <ChevronDown className="text-amber-400/30" size={28} />
        </motion.div>
      </motion.div>
    </section>
  );
}
