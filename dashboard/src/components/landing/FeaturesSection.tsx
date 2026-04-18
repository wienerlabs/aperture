'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  Shield,
  Zap,
  CreditCard,
  Settings,
  FileCheck,
  Lock,
  Bot,
} from 'lucide-react';

interface FeatureCardData {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const features: FeatureCardData[] = [
  {
    icon: <Shield size={24} />,
    title: 'ZK Proof Generation',
    description:
      'RISC Zero zkVM generates cryptographic proofs that verify compliance without revealing transaction details',
  },
  {
    icon: <Zap size={24} />,
    title: 'x402 Protocol',
    description:
      'Native Coinbase machine payment protocol integration for AI agent HTTP 402 flows',
  },
  {
    icon: <CreditCard size={24} />,
    title: 'MPP Support',
    description:
      'Stripe/Tempo Machine Payments Protocol for programmatic stablecoin payments',
  },
  {
    icon: <Settings size={24} />,
    title: 'Policy Engine',
    description:
      'Five comprehensive compliance checks: spending limits, sanctions, categories, time rules, token whitelists',
  },
  {
    icon: <FileCheck size={24} />,
    title: 'Batch Attestation',
    description:
      'Aggregate proofs into regulator-grade compliance reports with privacy-preserving amount ranges',
  },
  {
    icon: <Bot size={24} />,
    title: 'Autonomous Agent',
    description:
      'Headless AI agent with policy enforcement, ZK proving, dual-protocol payments (x402 + MPP), and Solana on-chain attestations',
  },
  {
    icon: <Lock size={24} />,
    title: 'Privacy First',
    description:
      'Payment amounts, recipients, and patterns are cryptographically hidden from public view',
  },
];

export function FeaturesSection() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      ref={ref}
      id="features"
      className="relative z-10 py-24"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 text-center mb-16"
        >
          Everything you need for private compliance
        </motion.h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: 'easeOut' }}
              whileHover={{
                boxShadow: '0 0 40px rgba(245,158,11,0.15)',
                borderColor: 'rgba(251,191,36,0.4)',
              }}
              className="bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-6 sm:p-8 transition-all duration-300"
            >
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-amber-400/10 text-amber-400 mb-4">
                {feature.icon}
              </div>
              <h3 className="font-mono text-base font-semibold text-amber-400 mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-amber-400/50 leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
