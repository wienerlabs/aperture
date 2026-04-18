'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion, useInView } from 'framer-motion';
import { Check } from 'lucide-react';

interface PricingTier {
  name: string;
  tagline: string;
  price: string;
  priceNote?: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlighted: boolean;
}

const tiers: PricingTier[] = [
  {
    name: 'Starter',
    tagline: 'For small teams',
    price: '$200',
    priceNote: '/year',
    features: [
      '1 operator',
      '5 policies',
      '1,000 proofs/month',
      'Community support',
    ],
    cta: 'Get Started',
    ctaHref: '/auth/signup',
    highlighted: false,
  },
  {
    name: 'Enterprise',
    tagline: 'For growing companies',
    price: '$50-200',
    priceNote: '/agent/month',
    features: [
      'Unlimited operators',
      'Unlimited policies',
      'Unlimited proofs',
      'Batch attestations',
      'Squads multisig',
      'Priority support',
    ],
    cta: 'Get Started',
    ctaHref: '/auth/signup',
    highlighted: true,
  },
  {
    name: 'Custom',
    tagline: 'For regulated enterprises',
    price: 'Contact us',
    features: [
      'Custom compliance reports',
      'Facilitator integration',
      'Dedicated support',
      'SLA guarantee',
    ],
    cta: 'Contact Sales',
    ctaHref: 'mailto:contact@aperture.dev',
    highlighted: false,
  },
];

export function PricingSection() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      ref={ref}
      id="pricing"
      className="relative z-10 py-24"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 text-center mb-4"
        >
          Simple, transparent pricing
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="font-mono text-sm text-amber-400/40 text-center mb-16"
        >
          Start free, scale as you grow
        </motion.p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
          {tiers.map((tier, i) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{ duration: 0.5, delay: i * 0.15, ease: 'easeOut' }}
              className={`relative bg-[rgba(10,10,10,0.8)] backdrop-blur-md rounded-xl p-6 sm:p-8 transition-all duration-300 flex flex-col ${
                tier.highlighted
                  ? 'border-2 border-amber-400 shadow-[0_0_40px_rgba(245,158,11,0.15)] md:scale-105 md:-my-2'
                  : 'border border-amber-400/20 hover:border-amber-400/40'
              }`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="font-mono text-xs px-3 py-1 bg-amber-400 text-[#000000] rounded-full font-semibold">
                    Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="font-mono text-lg font-bold text-amber-400 mb-1">
                  {tier.name}
                </h3>
                <p className="font-mono text-xs text-amber-400/40">
                  {tier.tagline}
                </p>
              </div>

              <div className="mb-6">
                <span className="font-mono text-3xl font-bold text-amber-400">
                  {tier.price}
                </span>
                {tier.priceNote && (
                  <span className="font-mono text-sm text-amber-400/40">
                    {tier.priceNote}
                  </span>
                )}
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check
                      size={16}
                      className="text-amber-400/60 mt-0.5 flex-shrink-0"
                    />
                    <span className="text-sm text-amber-400/50">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                href={tier.ctaHref}
                className={`font-mono text-sm px-6 py-3 rounded-lg font-semibold text-center transition-colors duration-200 block ${
                  tier.highlighted
                    ? 'bg-amber-400 text-[#000000] hover:bg-amber-300'
                    : 'border border-amber-400/20 text-amber-400 hover:border-amber-400/40 hover:bg-amber-400/5'
                }`}
              >
                {tier.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
