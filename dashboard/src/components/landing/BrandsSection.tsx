'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';

interface Brand {
  name: string;
  src: string;
  alt: string;
}

const brands: Brand[] = [
  { name: 'Solana', src: '/brands/solana.svg', alt: 'Solana' },
  { name: 'Helius', src: '/brands/helius.svg', alt: 'Helius' },
  { name: 'RISC Zero', src: '/brands/riscZero.svg', alt: 'RISC Zero' },
  { name: 'Light Protocol', src: '/brands/lighticon.svg', alt: 'Light Protocol' },
  { name: 'Coinbase', src: '/brands/Coinbase.svg', alt: 'Coinbase' },
  { name: 'Squads', src: '/brands/Squads.svg', alt: 'Squads' },
  { name: 'Stripe', src: '/brands/Stripe.svg', alt: 'Stripe' },
];

export function BrandsSection() {
  return (
    <section className="relative z-10 py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 text-center mb-16"
        >
          Built on, integrated with
        </motion.h2>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.8, delay: 0.15, ease: 'easeOut' }}
          className="flex flex-nowrap items-center justify-between gap-x-4 sm:gap-x-8 lg:gap-x-10 overflow-x-auto"
        >
          {brands.map((brand, index) => (
            <motion.div
              key={brand.name}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ duration: 0.5, delay: 0.1 + index * 0.05, ease: 'easeOut' }}
              className="flex items-center justify-center h-10 sm:h-12 shrink-0"
            >
              <Image
                src={brand.src}
                alt={brand.alt}
                width={160}
                height={48}
                className="h-5 sm:h-7 md:h-8 lg:h-9 w-auto object-contain opacity-60 hover:opacity-100 transition-opacity duration-300 grayscale hover:grayscale-0"
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
