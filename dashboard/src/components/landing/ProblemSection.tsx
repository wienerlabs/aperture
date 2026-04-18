'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { X, Check } from 'lucide-react';

interface ProblemCardProps {
  icon: 'x' | 'check';
  title: string;
  description: string;
  index: number;
}

function ProblemCard({ icon, title, description, index }: ProblemCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.6, delay: index * 0.15, ease: 'easeOut' }}
      whileHover={{
        boxShadow: '0 0 40px rgba(245,158,11,0.15)',
        borderColor: 'rgba(251,191,36,0.4)',
      }}
      className="relative bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6 sm:p-8 transition-all duration-300 flex flex-col items-start"
    >
      <div
        className={`flex items-center justify-center w-10 h-10 rounded-full mb-4 ${
          icon === 'check'
            ? 'bg-amber-400/10 text-amber-400'
            : 'bg-red-500/10 text-red-400'
        }`}
      >
        {icon === 'check' ? <Check size={20} /> : <X size={20} />}
      </div>
      <h3 className="font-mono text-lg font-semibold text-amber-400 mb-2">
        {title}
      </h3>
      <p className="text-sm text-amber-400/50 leading-relaxed">
        {description}
      </p>
    </motion.div>
  );
}

const cards: Omit<ProblemCardProps, 'index'>[] = [
  {
    icon: 'x',
    title: 'Full transparency',
    description:
      'Competitor intelligence leaks through on-chain payment data visible to everyone',
  },
  {
    icon: 'x',
    title: 'No on-chain payments',
    description:
      'Miss out on the agent economy by staying off-chain and losing composability',
  },
  {
    icon: 'check',
    title: 'Aperture',
    description:
      'Compliant and private. Prove policy adherence without revealing payment details',
  },
];

export function ProblemSection() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      ref={ref}
      id="problem"
      className="relative z-10 py-24"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 text-center mb-16"
        >
          The enterprise AI payment problem
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {cards.map((card, i) => (
            <ProblemCard key={card.title} {...card} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
