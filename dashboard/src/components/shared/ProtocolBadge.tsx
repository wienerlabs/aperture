'use client';

/**
 * ProtocolBadge — small "powered by X" inline badge for protocol references.
 * No background tile, no border tint — just the brand wordmark in subtle ink
 * with a wee bit of opacity so it doesn't jump out of the page rhythm. Sits
 * happily under the cards' headlines on the Payments tab.
 *
 * The image-source brands rely on /public/brands/*.svg (already patched to
 * use currentColor) so we can re-tint with `filter: brightness(0)` and have
 * the wordmark land in solid ink. Brands without a stock SVG (Coinbase x402
 * doesn't ship a separate "x402" wordmark) render as a typographic label.
 */

import Image, { type StaticImageData } from 'next/image';
import { cn } from '@/lib/utils';

export type ProtocolId =
  | 'solana'
  | 'coinbase'
  | 'stripe'
  | 'light'
  | 'helius'
  | 'squads'
  | 'circom'
  | 'anchor';

interface ProtocolMeta {
  readonly label: string;
  readonly src?: string | StaticImageData;
  /** Pixel height — tuned per logo so the optical weight reads even. */
  readonly height: number;
}

const REGISTRY: Record<ProtocolId, ProtocolMeta> = {
  solana:   { label: 'Solana',         src: '/brands/solana.svg',   height: 14 },
  coinbase: { label: 'Coinbase',       src: '/brands/Coinbase.svg', height: 14 },
  stripe:   { label: 'Stripe',         src: '/brands/Stripe.svg',   height: 12 },
  light:    { label: 'Light Protocol', src: '/brands/lighticon.svg', height: 14 },
  helius:   { label: 'Helius',         src: '/brands/helius.svg',   height: 14 },
  squads:   { label: 'Squads',         src: '/brands/Squads.svg',   height: 14 },
  circom:   { label: 'Circom',                                       height: 14 },
  anchor:   { label: 'Anchor',                                       height: 14 },
};

interface ProtocolBadgeProps {
  readonly protocol: ProtocolId;
  /** Show the wordmark text alongside the logo. Default: false (logo-only). */
  readonly showLabel?: boolean;
  readonly className?: string;
}

export function ProtocolBadge({
  protocol,
  showLabel = false,
  className,
}: ProtocolBadgeProps) {
  const meta = REGISTRY[protocol];
  const hasImage = Boolean(meta.src);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 align-middle text-black/55',
        className,
      )}
      title={meta.label}
    >
      {hasImage ? (
        <Image
          src={meta.src as string}
          alt={meta.label}
          width={meta.height * 4}
          height={meta.height}
          className="object-contain w-auto"
          style={{
            // brightness(0) collapses every visible pixel to solid black so
            // the heterogeneous brand colours in /public/brands all read as
            // one quiet wordmark on the white card.
            filter: 'brightness(0)',
            opacity: 0.55,
            height: `${meta.height}px`,
          }}
        />
      ) : (
        // Brands without an SVG (Circom, Anchor) — quiet typographic label.
        <span
          className="font-display text-[13px] tracking-[-0.012em] text-black/55"
          style={{ lineHeight: `${meta.height}px` }}
        >
          {meta.label.toLowerCase()}
        </span>
      )}
      {showLabel && hasImage && (
        <span className="text-[11px] tracking-tighter text-black/55">{meta.label}</span>
      )}
    </span>
  );
}

interface ProtocolBadgeRowProps {
  readonly label?: string;
  readonly protocols: readonly ProtocolId[];
  readonly className?: string;
}

/**
 * ProtocolBadgeRow — labelled row of badges. e.g.
 *   "Powered by  [Coinbase] [Solana]"
 * Used as the small footer line under each PaymentMethodCard headline.
 */
export function ProtocolBadgeRow({
  label = 'Powered by',
  protocols,
  className,
}: ProtocolBadgeRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 flex-wrap text-[11px] uppercase tracking-[0.08em] text-black/45',
        className,
      )}
    >
      <span>{label}</span>
      <span className="flex items-center gap-3">
        {protocols.map((p) => (
          <ProtocolBadge key={p} protocol={p} />
        ))}
      </span>
    </div>
  );
}
