'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Briefcase, Scale, Code2 } from 'lucide-react';

interface UseCaseData {
  icon: React.ReactNode;
  role: string;
  title: string;
  problem: string;
  solution: string;
}

const useCases: UseCaseData[] = [
  {
    icon: <Briefcase size={24} />,
    role: 'CFO',
    title: 'Chief Financial Officer',
    problem:
      'Need to control AI agent spending without revealing strategy',
    solution:
      'Policy engine with daily and per-transaction limits, real-time compliance',
  },
  {
    icon: <Scale size={24} />,
    role: 'CLO',
    title: 'Chief Legal Officer',
    problem:
      'Regulatory compliance requires proof without exposing trade secrets',
    solution:
      'ZK attestations prove policy adherence, batch reports for regulators',
  },
  {
    icon: <Code2 size={24} />,
    role: 'CTO',
    title: 'Chief Technology Officer',
    problem:
      'Integrate compliance into existing payment infrastructure',
    solution:
      'Drop-in x402 and MPP adapters, Solana program composability',
  },
];

export function UseCasesSection() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section ref={ref} className="relative z-10 py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 text-center mb-4"
        >
          Built for the C-suite
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="font-mono text-sm text-amber-400/40 text-center mb-16"
        >
          Every stakeholder gets the guarantees they need
        </motion.p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {useCases.map((uc, i) => (
            <motion.div
              key={uc.role}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{ duration: 0.5, delay: i * 0.15, ease: 'easeOut' }}
              whileHover={{
                boxShadow: '0 0 40px rgba(245,158,11,0.12)',
                borderColor: 'rgba(251,191,36,0.4)',
              }}
              className="bg-[rgba(20,14,0,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6 sm:p-8 transition-all duration-300 flex flex-col"
            >
              <div className="flex items-center gap-3 mb-5">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-400/10 text-amber-400">
                  {uc.icon}
                </div>
                <div>
                  <span className="font-mono text-lg font-bold text-amber-400 block">
                    {uc.role}
                  </span>
                  <span className="font-mono text-xs text-amber-400/40">
                    {uc.title}
                  </span>
                </div>
              </div>

              <div className="mb-4">
                <span className="font-mono text-xs text-red-400/60 uppercase tracking-wider block mb-1">
                  Problem
                </span>
                <p className="text-sm text-amber-400/50 leading-relaxed">
                  {uc.problem}
                </p>
              </div>

              <div className="mt-auto pt-4 border-t border-amber-400/10">
                <span className="font-mono text-xs text-amber-400/60 uppercase tracking-wider block mb-1">
                  Solution
                </span>
                <p className="text-sm text-amber-400/70 leading-relaxed">
                  {uc.solution}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
