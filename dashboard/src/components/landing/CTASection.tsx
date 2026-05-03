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
          className="ap-card relative p-12 sm:p-16 text-center overflow-hidden"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(248,179,0,0.06)_0%,transparent_70%)]" />

          <div className="relative z-10">
            <h2 className="font-display text-[32px] sm:text-[40px] md:text-[48px] font-normal text-ink mb-4 leading-[1.05] tracking-[-0.01em]">
              Start building compliant AI agents today
            </h2>
            <p className="text-[16px] text-ink-slate mb-8 max-w-md mx-auto tracking-tighter">
              Deploy privacy-preserving payment compliance in minutes, not months
            </p>
            <Link href="/auth/signup" className="ap-btn-orange">
              Get Started
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
