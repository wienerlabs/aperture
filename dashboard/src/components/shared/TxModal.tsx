'use client';

/**
 * Aperture TX modal — based on @dorianbaffier's CurrencyTransfer card from
 * kokonutui.com (MIT). Repainted to match the Aperture design system:
 *  - White card surface, Antimetal feature-card shadow, 20px radius
 *  - Brand orange (#f8b300) accent everywhere; no green/emerald
 *  - Host Grotesk for UI text, KMR Waldenburg for the "Transfer" headline
 *  - Hooked to a real tx state (idle | pending | success | error)
 *  - Adds a close button + escape/backdrop dismissal
 *  - Solana Explorer link for the signature
 *
 * Original credits preserved per the source license:
 *   author:   @dorianbaffier
 *   website:  https://kokonutui.com
 *   github:   https://github.com/kokonut-labs/kokonutui
 *   license:  MIT
 */

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownIcon,
  ArrowUpDown,
  ArrowUpIcon,
  Check,
  ExternalLink,
  InfoIcon,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { config as apertureConfig } from '@/lib/config';
import { truncateAddress, formatAmount } from '@/lib/utils';

export type TxStatus = 'idle' | 'pending' | 'success' | 'error';

export interface TxParticipant {
  /** A short symbol (USDC, USDT, aUSDC, $, ...) shown in the rounded chip. */
  readonly symbol: string;
  /** Human-readable amount, e.g. "500.00 USDC". */
  readonly amountLabel: string;
  /** Sub-label, e.g. wallet ATA short, treasury name. */
  readonly accountLabel: string;
}

export interface TxModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly status: TxStatus;
  /** Heading shown in the upper section. Defaults to "Transfer" / "Transfer Completed". */
  readonly title?: string;
  /** Optional subtitle override. By default we render the txId. */
  readonly subtitle?: string;
  /** Sender side — agent / user wallet. */
  readonly from: TxParticipant;
  /** Receiver side — treasury / paywalled resource. */
  readonly to: TxParticipant;
  /** Solana transaction signature (base58). When set the explorer link is shown. */
  readonly txSignature?: string | null;
  /** Optional auxiliary info displayed below the from/to rows. */
  readonly footnote?: string;
  /** Optional error message when status === 'error'. */
  readonly errorMessage?: string;
}

const draw = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: (i: number) => ({
    pathLength: 1,
    opacity: 1,
    transition: {
      pathLength: {
        delay: i * 0.2,
        type: 'spring',
        duration: 1.5,
        bounce: 0.2,
        ease: [0.22, 1, 0.36, 1],
      },
      opacity: { delay: i * 0.2, duration: 0.3 },
    },
  }),
};

interface CheckmarkProps {
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
}

export function Checkmark({
  size = 100,
  strokeWidth = 2,
  color = '#f8b300',
  className = '',
}: CheckmarkProps) {
  return (
    <motion.svg
      animate="visible"
      className={className}
      height={size}
      initial="hidden"
      viewBox="0 0 100 100"
      width={size}
    >
      <title>Transfer complete</title>
      <motion.circle
        custom={0}
        cx="50"
        cy="50"
        r="42"
        stroke={color}
        style={{
          strokeWidth,
          strokeLinecap: 'round',
          fill: 'transparent',
          filter: 'drop-shadow(0 0 2px rgba(248, 179, 0, 0.25))',
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variants={draw as any}
      />
      <motion.path
        custom={1}
        d="M32 50L45 63L68 35"
        stroke={color}
        style={{
          strokeWidth: strokeWidth + 0.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: 'transparent',
          filter: 'drop-shadow(0 0 1px rgba(248, 179, 0, 0.35))',
        }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variants={draw as any}
      />
    </motion.svg>
  );
}

export function TxModal({
  open,
  onClose,
  status,
  title,
  subtitle,
  from,
  to,
  txSignature,
  footnote,
  errorMessage,
}: TxModalProps) {
  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isPending = status === 'pending';
  const isSuccess = status === 'success';
  const isError = status === 'error';

  const heading =
    title ??
    (isSuccess ? 'Transfer Completed' : isError ? 'Transfer Failed' : 'Transfer in Progress');

  const subText =
    subtitle ??
    (isSuccess && txSignature
      ? `Transaction: ${truncateAddress(txSignature, 6)}`
      : isPending
        ? 'Verifying ZK proof and signing inner transfer…'
        : isError
          ? errorMessage ?? 'Something went wrong.'
          : 'Idle');

  return (
    <AnimatePresence>
      {open && (
        <TooltipProvider>
          <motion.div
            key="tx-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/35 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Aperture transfer status"
          >
            <motion.div
              key="tx-card"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <Card
                className="relative mx-auto flex h-[460px] w-full max-w-sm flex-col p-6 bg-white"
                style={{
                  borderRadius: 'var(--radius-cards)',
                  boxShadow: 'var(--shadow-card)',
                  border: 'none',
                }}
              >
                {/* Close */}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-pill text-black/60 hover:bg-black/5 hover:text-black transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>

                <CardContent className="flex flex-1 flex-col justify-center space-y-4 p-0">
                  {/* Status badge / spinner */}
                  <div className="flex h-[100px] items-center justify-center">
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-center"
                      initial={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <div className="relative flex h-[100px] w-[100px] items-center justify-center">
                        <motion.div
                          animate={{ opacity: [0, 1, 0.8] }}
                          className="absolute inset-0 rounded-full bg-[#f8b300]/12 blur-2xl"
                          initial={{ opacity: 0 }}
                          transition={{
                            duration: 1.5,
                            times: [0, 0.5, 1],
                            ease: [0.22, 1, 0.36, 1],
                          }}
                        />
                        <AnimatePresence mode="wait">
                          {isSuccess ? (
                            <motion.div
                              key="completed"
                              animate={{ opacity: 1, rotate: 0 }}
                              initial={{ opacity: 0, rotate: -180 }}
                              transition={{ duration: 0.6, ease: 'easeInOut' }}
                              className="flex h-[100px] w-[100px] items-center justify-center"
                            >
                              <div className="relative z-10 rounded-full border border-[#f8b300] bg-white p-5">
                                <Check className="h-10 w-10 text-[#f8b300]" strokeWidth={3.5} />
                              </div>
                            </motion.div>
                          ) : isError ? (
                            <motion.div
                              key="error"
                              animate={{ opacity: 1, scale: 1 }}
                              initial={{ opacity: 0, scale: 0.9 }}
                              transition={{ duration: 0.4 }}
                              className="flex h-[100px] w-[100px] items-center justify-center"
                            >
                              <div className="relative z-10 rounded-full border border-red-500 bg-white p-5">
                                <AlertTriangle className="h-10 w-10 text-red-500" strokeWidth={2.5} />
                              </div>
                            </motion.div>
                          ) : (
                            <motion.div
                              key="progress"
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0, rotate: 360 }}
                              initial={{ opacity: 0 }}
                              transition={{ duration: 0.6, ease: 'easeInOut' }}
                              className="flex h-[100px] w-[100px] items-center justify-center"
                            >
                              <div className="relative z-10">
                                <motion.div
                                  animate={{ rotate: 360, scale: [1, 1.02, 1] }}
                                  className="absolute inset-0 rounded-full border-2 border-transparent"
                                  style={{
                                    borderLeftColor: '#f8b300',
                                    borderTopColor: 'rgba(248, 179, 0, 0.25)',
                                    filter: 'blur(0.5px)',
                                  }}
                                  transition={{
                                    rotate: {
                                      duration: 3,
                                      repeat: Number.POSITIVE_INFINITY,
                                      ease: 'linear',
                                    },
                                    scale: {
                                      duration: 2,
                                      repeat: Number.POSITIVE_INFINITY,
                                      ease: 'easeInOut',
                                    },
                                  }}
                                />
                                <div className="relative z-10 rounded-full bg-white p-5 shadow-[0_0_15px_rgba(248,179,0,0.18)]">
                                  <ArrowUpDown className="h-10 w-10 text-[#f8b300]" />
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  </div>

                  {/* Title + subtitle */}
                  <div className="flex flex-col">
                    <motion.div
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-3 w-full space-y-1.5 text-center"
                      initial={{ opacity: 0, y: 10 }}
                      transition={{ delay: 0.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    >
                      <AnimatePresence mode="wait">
                        <motion.h2
                          key={`title-${status}`}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -12 }}
                          initial={{ opacity: 0, y: 12 }}
                          transition={{ duration: 0.4 }}
                          className="font-display text-[22px] leading-[1.15] tracking-[-0.012em] text-black"
                        >
                          {heading}
                        </motion.h2>
                      </AnimatePresence>

                      <AnimatePresence mode="wait">
                        <motion.div
                          key={`sub-${status}-${txSignature ?? ''}`}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          initial={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.35 }}
                          className={cn(
                            'text-[12px] tracking-tighter',
                            isError ? 'text-red-600' : 'text-[#c98f00]',
                          )}
                        >
                          {subText}
                        </motion.div>
                      </AnimatePresence>
                    </motion.div>

                    {/* From / To rows */}
                    <motion.div
                      animate={{ gap: isSuccess ? '0px' : '12px' }}
                      className="relative flex flex-col items-start"
                      initial={{ gap: '12px' }}
                      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
                    >
                      <ParticipantRow
                        side="from"
                        participant={from}
                        merged={isSuccess}
                        dim={!isSuccess}
                      />
                      <ParticipantRow
                        side="to"
                        participant={to}
                        merged={isSuccess}
                        dim={!isSuccess}
                      />
                    </motion.div>

                    {/* Footnote / actions */}
                    <motion.div
                      animate={{ opacity: 1 }}
                      className="mt-3 flex items-center justify-center gap-2 text-[12px] text-black/55"
                      initial={{ opacity: 0 }}
                      transition={{ delay: 0.4, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {isSuccess && txSignature ? (
                        <a
                          href={apertureConfig.txExplorerUrl(txSignature)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-[12px] tracking-tighter text-black hover:bg-black/5 transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          View on Solana Explorer
                        </a>
                      ) : (
                        <>
                          <span>{footnote ?? (isPending ? 'Verifying Groth16 proof on-chain…' : '')}</span>
                          {(footnote || isPending) && (
                            <Tooltip>
                              <TooltipTrigger>
                                <InfoIcon className="h-3 w-3 text-black/40 hover:text-black/70 transition-colors" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  {isPending
                                    ? 'alt_bn128 pairing + atomic SPL transfer in one Anchor instruction.'
                                    : footnote}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </motion.div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>
        </TooltipProvider>
      )}
    </AnimatePresence>
  );
}

function ParticipantRow({
  side,
  participant,
  merged,
  dim,
}: {
  side: 'from' | 'to';
  participant: TxParticipant;
  merged: boolean;
  dim: boolean;
}) {
  const Icon = side === 'from' ? ArrowUpIcon : ArrowDownIcon;
  return (
    <motion.div
      animate={{ y: 0, scale: 1 }}
      className={cn(
        'w-full p-2.5 backdrop-blur-md transition-all duration-300',
        'border border-black/8 bg-[rgba(248,179,0,0.04)]',
        merged
          ? side === 'from'
            ? 'rounded-[16px] rounded-b-none border-b-0'
            : 'rounded-[16px] rounded-t-none border-t-0'
          : 'rounded-[16px] hover:border-[#f8b300]/40',
      )}
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="w-full space-y-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-black/55 tracking-tighter uppercase">
          <Icon className="h-3 w-3" />
          {side === 'from' ? 'From' : 'To'}
        </span>
        <div className="flex items-center gap-2.5">
          <motion.span
            className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-pill border border-black/10 bg-white px-2 text-[12px] font-medium text-black shadow-sm transition-colors"
            transition={{ type: 'spring', stiffness: 400, damping: 10 }}
            whileHover={{ scale: 1.05 }}
          >
            {participant.symbol}
          </motion.span>
          <div className="flex flex-col items-start">
            <span
              className={cn(
                'text-[14px] font-medium text-black tracking-tighter',
                dim ? 'opacity-60' : 'opacity-100',
              )}
            >
              {participant.amountLabel}
            </span>
            <span className="text-[11px] text-black/55 tracking-tighter">
              {participant.accountLabel}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Build participant rows from a real ZK-proof payment context. This helper
 * keeps the UI dumb and lets the calling page (PaymentsTab, AIPAgentsTab,
 * MPP webhook handler, x402 client) provide the data.
 */
export function makeFromParticipant(opts: {
  walletPubkey: string;
  tokenSymbol: string;
  amountLamports: bigint;
}): TxParticipant {
  return {
    symbol: opts.tokenSymbol,
    amountLabel: `${formatAmount(opts.amountLamports.toString())} ${opts.tokenSymbol}`,
    accountLabel: `Wallet ${truncateAddress(opts.walletPubkey, 4)}`,
  };
}

export function makeToParticipant(opts: {
  treasuryPubkey: string;
  tokenSymbol: string;
  amountLamports: bigint;
  resourceLabel?: string;
}): TxParticipant {
  return {
    symbol: opts.tokenSymbol,
    amountLabel: `${formatAmount(opts.amountLamports.toString())} ${opts.tokenSymbol}`,
    accountLabel:
      opts.resourceLabel ?? `Treasury ${truncateAddress(opts.treasuryPubkey, 4)}`,
  };
}
