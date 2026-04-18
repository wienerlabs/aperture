'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { FileText, Cpu, Send, ShieldCheck } from 'lucide-react';

interface StepData {
  icon: React.ReactNode;
  number: string;
  title: string;
  description: string;
}

const steps: StepData[] = [
  {
    icon: <FileText size={24} />,
    number: '01',
    title: 'Define Policy',
    description:
      'Operators set spending limits, allowed categories, sanctions lists, and time restrictions',
  },
  {
    icon: <Cpu size={24} />,
    number: '02',
    title: 'Generate Proof',
    description:
      'RISC Zero zkVM produces a cryptographic proof of policy compliance',
  },
  {
    icon: <Send size={24} />,
    number: '03',
    title: 'Pay & Attach',
    description:
      'x402 or MPP payment carries the proof in its header',
  },
  {
    icon: <ShieldCheck size={24} />,
    number: '04',
    title: 'Verify On-chain',
    description:
      'Solana verifier program validates the proof and creates an immutable record',
  },
];

function ConnectorArrow({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0 }}
      whileInView={{ opacity: 1, scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.4 + index * 0.15 }}
      className="hidden lg:flex items-center justify-center origin-left"
    >
      <div className="w-12 h-px bg-gradient-to-r from-amber-400/40 to-amber-400/10" />
      <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-amber-400/30" />
    </motion.div>
  );
}

export function HowItWorksSection() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      ref={ref}
      id="how-it-works"
      className="relative z-10 py-24"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 text-center mb-16"
        >
          Four steps to private compliance
        </motion.h2>

        {/* Desktop horizontal layout */}
        <div className="hidden lg:flex items-stretch justify-center gap-0">
          {steps.map((step, i) => (
            <div key={step.number} className="flex items-center">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15, ease: 'easeOut' }}
                className="relative bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6 w-60 flex flex-col items-center text-center hover:border-amber-400/40 hover:shadow-[0_0_30px_rgba(245,158,11,0.1)] transition-all duration-300"
              >
                <span className="font-mono text-xs text-amber-400/30 mb-3">
                  {step.number}
                </span>
                <div className="text-amber-400 mb-3">{step.icon}</div>
                <h3 className="font-mono text-base font-semibold text-amber-400 mb-2">
                  {step.title}
                </h3>
                <p className="text-xs text-amber-400/50 leading-relaxed">
                  {step.description}
                </p>
              </motion.div>
              {i < steps.length - 1 && <ConnectorArrow index={i} />}
            </div>
          ))}
        </div>

        {/* Mobile/tablet vertical layout */}
        <div className="flex lg:hidden flex-col items-center gap-0">
          {steps.map((step, i) => (
            <div key={step.number} className="flex flex-col items-center">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: 'easeOut' }}
                className="relative bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6 w-full max-w-sm flex flex-col items-center text-center"
              >
                <span className="font-mono text-xs text-amber-400/30 mb-3">
                  {step.number}
                </span>
                <div className="text-amber-400 mb-3">{step.icon}</div>
                <h3 className="font-mono text-base font-semibold text-amber-400 mb-2">
                  {step.title}
                </h3>
                <p className="text-xs text-amber-400/50 leading-relaxed">
                  {step.description}
                </p>
              </motion.div>
              {i < steps.length - 1 && (
                <motion.div
                  initial={{ scaleY: 0 }}
                  whileInView={{ scaleY: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: 0.2 + i * 0.1 }}
                  className="w-px h-8 bg-gradient-to-b from-amber-400/40 to-amber-400/10 origin-top"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
