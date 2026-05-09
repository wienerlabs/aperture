'use client';

/**
 * MemberAvatar — deterministic identicon for Squads members.
 *
 * Renders a 5x5 symmetric grid of orange-tinted blocks derived from the
 * pubkey, plus a tiny ring of meta dots that visualise the permission
 * mask (propose / vote / execute). The whole thing is pure SVG so it
 * scales with the surrounding pill and animates cleanly.
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface MemberAvatarProps {
  readonly pubkey: string;
  readonly size?: number;
  readonly highlight?: boolean;
  readonly permissionsMask?: number;
}

/** Hash a string into a 32-bit integer (djb2). Stable across renders. */
function hashString(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

const APERTURE_PALETTE = [
  '#f8b300',
  '#c98f00',
  '#ffd066',
  '#a36b00',
  '#ffe199',
];

export function MemberAvatar({
  pubkey,
  size = 40,
  highlight = false,
  permissionsMask = 0,
}: MemberAvatarProps): JSX.Element {
  const grid = useMemo(() => buildGrid(pubkey), [pubkey]);
  const cell = size / 5;
  const baseColor = APERTURE_PALETTE[hashString(pubkey) % APERTURE_PALETTE.length];

  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className="rounded-[8px] overflow-hidden"
        style={{
          background: 'rgba(248, 179, 0, 0.06)',
          boxShadow: highlight
            ? '0 0 0 2px rgba(248, 179, 0, 0.45), 0 6px 14px -6px rgba(101, 69, 0, 0.35)'
            : '0 0 0 1px rgba(0, 0, 0, 0.06)',
        }}
      >
        {grid.map((row, y) =>
          row.map((on, x) => {
            if (!on) return null;
            return (
              <motion.rect
                key={`${y}-${x}`}
                x={x * cell}
                y={y * cell}
                width={cell}
                height={cell}
                fill={baseColor}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                  duration: 0.35,
                  delay: 0.04 * (y * 5 + x),
                  ease: [0.22, 1, 0.36, 1],
                }}
              />
            );
          }),
        )}
      </svg>

      {permissionsMask > 0 && (
        <PermissionRing mask={permissionsMask} size={size} />
      )}
    </motion.div>
  );
}

/**
 * 5x5 boolean grid that is mirrored on the vertical axis. Anyone who has
 * ever shipped GitHub identicons knows the pattern; we keep it cheap so
 * a wallet with hundreds of members still renders instantly.
 */
function buildGrid(pubkey: string): boolean[][] {
  const seed = hashString(pubkey);
  const grid: boolean[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 3; x++) {
      const bit = (seed >> ((y * 3 + x) % 30)) & 1;
      row.push(Boolean(bit));
    }
    // Mirror columns 0 and 1 onto 4 and 3 so the avatar reads symmetric.
    row.push(row[1]);
    row.push(row[0]);
    grid.push(row);
  }
  return grid;
}

function PermissionRing({ mask, size }: { mask: number; size: number }): JSX.Element {
  // Three dots at top-right indicate which permission bits are present.
  const dots = [
    { bit: 1 << 0, color: '#16a34a', title: 'propose' }, // green
    { bit: 1 << 1, color: '#0891b2', title: 'vote' },     // cyan
    { bit: 1 << 2, color: '#c98f00', title: 'execute' },  // orange
  ];
  return (
    <div
      aria-hidden
      className="absolute -bottom-0.5 -right-0.5 inline-flex items-center gap-[2px] rounded-full bg-white px-1 py-[2px]"
      style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.08)' }}
    >
      {dots.map((dot) => {
        const enabled = (mask & dot.bit) !== 0;
        return (
          <span
            key={dot.title}
            title={dot.title}
            className="block rounded-full"
            style={{
              width: Math.max(3, Math.floor(size / 14)),
              height: Math.max(3, Math.floor(size / 14)),
              background: enabled ? dot.color : 'rgba(0,0,0,0.08)',
            }}
          />
        );
      })}
    </div>
  );
}
