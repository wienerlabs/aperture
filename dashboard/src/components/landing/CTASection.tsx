'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

export function CTASection() {
  return (
    <section className="relative z-10 py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-2xl p-12 sm:p-16 text-center overflow-hidden"
        >
          {/* Background glow */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.06)_0%,transparent_70%)]" />

          <div className="relative z-10">
            <h2 className="font-mono text-2xl sm:text-3xl md:text-4xl font-bold text-amber-400 mb-4">
              Start building compliant AI agents today
            </h2>
            <p className="font-mono text-sm text-amber-400/40 mb-8 max-w-md mx-auto">
              Deploy privacy-preserving payment compliance in minutes, not months
            </p>
            <Link
              href="/auth/signup"
              className="inline-block font-mono text-sm px-8 py-3 bg-amber-400 text-[#000000] rounded-lg font-semibold hover:bg-amber-300 transition-colors duration-200 shadow-[0_0_30px_rgba(245,158,11,0.2)]"
            >
              Get Started
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
