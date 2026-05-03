'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { Sparkles } from '@/components/ui/sparkles';
import { InfiniteSlider } from '@/components/ui/infinite-slider';
import { ProgressiveBlur } from '@/components/ui/progressive-blur';

/**
 * Partner logo strip — adapted from the lepikhinb/sparkles 21st.dev demo,
 * recoloured to the Aperture orange/black palette and wired against the
 * actual integrations called out in the README:
 *   Solana, Helius, Circom, Light Protocol, Coinbase, Squads, Stripe, Anchor
 *
 * Image-based brands use `filter: brightness(0)` so the colourful source
 * SVGs render as a uniform monochrome wordmark on the white canvas. The two
 * brands without ready-made logos in /public/brands (Circom, Anchor) ship as
 * lightweight typographic wordmarks instead — which keeps the strip honest
 * about what's actually integrated, without inventing fake assets.
 */

interface PartnerEntry {
  readonly id: string;
  readonly label: string;
  readonly imgSrc?: string;
  /** Tailwind width class; tuned per logo so the strip reads evenly. */
  readonly widthClass: string;
}

const partners: readonly PartnerEntry[] = [
  { id: 'solana', label: 'Solana', imgSrc: '/brands/solana.svg', widthClass: 'w-32' },
  { id: 'helius', label: 'Helius', imgSrc: '/brands/helius.svg', widthClass: 'w-28' },
  { id: 'circom', label: 'Circom', widthClass: 'w-28' },
  { id: 'light', label: 'Light Protocol', imgSrc: '/brands/lighticon.svg', widthClass: 'w-12' },
  { id: 'coinbase', label: 'Coinbase', imgSrc: '/brands/Coinbase.svg', widthClass: 'w-32' },
  { id: 'squads', label: 'Squads', imgSrc: '/brands/Squads.svg', widthClass: 'w-28' },
  { id: 'stripe', label: 'Stripe', imgSrc: '/brands/Stripe.svg', widthClass: 'w-20' },
  { id: 'anchor', label: 'Anchor', widthClass: 'w-28' },
];

export function BrandsSection() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="relative z-10 mx-auto max-w-page px-6 lg:px-8 pt-24 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <h2 className="font-display text-[28px] sm:text-[36px] md:text-[44px] leading-[1.05] tracking-[-0.012em] text-black">
            <span className="text-aperture-dark">Built on,</span>
            <br />
            <span>integrated with.</span>
          </h2>
        </motion.div>

        {/* Logo marquee */}
        <div className="relative mt-10 h-[100px] w-full">
          <InfiniteSlider
            className="flex h-full w-full items-center"
            duration={36}
            gap={64}
          >
            {partners.map((partner) => (
              <PartnerLogo key={partner.id} partner={partner} />
            ))}
          </InfiniteSlider>

          <ProgressiveBlur
            className="pointer-events-none absolute top-0 left-0 h-full w-[160px]"
            direction="left"
            blurIntensity={1}
          />
          <ProgressiveBlur
            className="pointer-events-none absolute top-0 right-0 h-full w-[160px]"
            direction="right"
            blurIntensity={1}
          />
        </div>
      </div>

      {/* Sparkles plinth — subtle orange particles fading from the curved
          horizon below the marquee. Mimics the "trusted by" effect from
          21st.dev/r/lepikhinb but in Aperture's palette. */}
      <div className="relative -mt-16 h-72 w-full overflow-hidden [mask-image:radial-gradient(50%_60%_at_50%_50%,white,transparent)]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at bottom center, rgba(248,179,0,0.35) 0%, transparent 70%)',
            opacity: 0.6,
          }}
        />
        <div className="absolute -left-1/2 top-1/2 z-10 aspect-[1/0.7] w-[200%] rounded-[100%] border-t border-black/10 bg-white" />
        <Sparkles
          density={900}
          color="#f8b300"
          className="absolute inset-x-0 bottom-0 h-full w-full [mask-image:radial-gradient(50%_50%_at_50%_50%,white,transparent_85%)]"
        />
      </div>
    </section>
  );
}

function PartnerLogo({ partner }: { partner: PartnerEntry }) {
  return (
    <div
      className={`flex h-10 sm:h-12 shrink-0 items-center justify-center text-black ${partner.widthClass}`}
      aria-label={partner.label}
    >
      {partner.imgSrc ? (
        <Image
          src={partner.imgSrc}
          alt={partner.label}
          width={160}
          height={48}
          className="h-full w-full object-contain opacity-65 transition-opacity duration-300 hover:opacity-100"
          // brightness(0) collapses every visible pixel to solid black so
          // the heterogeneous brand colours (Solana gradient, Helius gradient,
          // Light Protocol blue, Stripe purple) all render as a uniform
          // wordmark on the white canvas.
          style={{ filter: 'brightness(0)' }}
          priority={false}
        />
      ) : (
        <span className="font-display text-[22px] sm:text-[26px] tracking-[-0.012em] text-black opacity-65 transition-opacity duration-300 hover:opacity-100">
          {partner.label.toLowerCase()}
        </span>
      )}
    </div>
  );
}
