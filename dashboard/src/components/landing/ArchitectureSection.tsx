'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

interface LayerData {
  name: string;
  label: string;
  description: string;
}

const layers: LayerData[] = [
  {
    name: 'Circom + Groth16',
    label: 'ZK Proof Engine',
    description: 'Circom circuit proves compliance, snarkjs generates a 256-byte Groth16 proof in ~500 ms',
  },
  {
    name: 'Solana',
    label: 'Settlement Layer',
    description: 'On-chain verifier validates proofs and anchors attestations',
  },
  {
    name: 'Light Protocol',
    label: 'Privacy Layer',
    description: 'Compressed accounts and state trees for private data storage',
  },
  {
    name: 'SPL Token-2022',
    label: 'Token Standard',
    description: 'Transfer hooks enforce compliance checks at the token level',
  },
  {
    name: 'Squads',
    label: 'Access Control',
    description: 'Multisig governance for policy management and treasury',
  },
];

function ConnectorArrowDown({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ scaleY: 0, opacity: 0 }}
      whileInView={{ scaleY: 1, opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.3 + index * 0.12 }}
      className="flex flex-col items-center py-1 origin-top"
    >
      <div className="w-px h-6 bg-gradient-to-b from-amber-400/40 to-amber-400/20" />
      <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px] border-t-amber-400/30" />
    </motion.div>
  );
}

export function ArchitectureSection() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      ref={ref}
      id="architecture"
      className="relative z-10 py-24"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 text-center mb-4"
        >
          Built on battle-tested infrastructure
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="font-mono text-sm text-amber-400/40 text-center mb-16"
        >
          Each layer adds a critical capability to the Aperture stack
        </motion.p>

        <div className="flex flex-col items-center max-w-xl mx-auto">
          {layers.map((layer, i) => (
            <div key={layer.name} className="flex flex-col items-center w-full">
              <motion.div
                initial={{ opacity: 0, x: i % 2 === 0 ? -30 : 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.12, ease: 'easeOut' }}
                whileHover={{
                  boxShadow: '0 0 40px rgba(245,158,11,0.12)',
                  borderColor: 'rgba(251,191,36,0.4)',
                }}
                className="w-full bg-[rgba(10,10,10,0.8)] backdrop-blur-md border border-amber-400/20 rounded-xl p-5 sm:p-6 transition-all duration-300"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-shrink-0">
                    <span className="font-mono text-xs text-amber-400/30 block mb-1">
                      L{i + 1}
                    </span>
                    <span className="font-mono text-base font-bold text-amber-400">
                      {layer.name}
                    </span>
                  </div>
                  <div className="h-8 w-px bg-amber-400/10" />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-xs text-amber-400/60 block">
                      {layer.label}
                    </span>
                    <p className="text-xs text-amber-400/40 mt-0.5 leading-relaxed">
                      {layer.description}
                    </p>
                  </div>
                </div>
              </motion.div>
              {i < layers.length - 1 && <ConnectorArrowDown index={i} />}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
