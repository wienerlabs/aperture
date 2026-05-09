'use client';

/**
 * MultisigBindingCard — the unbound state, rebuilt as a 4-step wizard
 * with a horizontal stepper, framer-motion entrance/exit transitions
 * between phases, and live confirmation feedback when the wallet is
 * signing set_multisig.
 *
 * Phases:
 *   1. paste     — operator types the multisig address + picks vault index
 *   2. preview   — policy-service returns RPC snapshot, we render members
 *   3. confirm   — wallet pops up to sign set_multisig
 *   4. confirmed — final flash before MultisigTab swaps to overview view
 *
 * Backend cache write happens only after the on-chain tx confirms, so
 * the UI is always honest about what's been persisted where.
 */

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Loader2,
  Search,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  Sparkles,
} from 'lucide-react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Transaction, PublicKey } from '@solana/web3.js';
import { config as apertureConfig } from '@/lib/config';
import { multisigApi, type MultisigSnapshot, type MultisigBinding } from '@/lib/api';
import { buildSetMultisigIx } from '@/lib/anchor-instructions';
import { ApInput } from '../policies/ApField';
import { MembersList } from './MembersList';

interface MultisigBindingCardProps {
  readonly operatorId: string;
  readonly walletAddress: string | null;
  readonly onBound: (binding: MultisigBinding) => void;
}

type Phase = 'paste' | 'looking-up' | 'preview' | 'binding' | 'confirmed';

const STEPS: ReadonlyArray<{
  id: Exclude<Phase, 'looking-up'>;
  label: string;
  icon: typeof ClipboardPaste;
}> = [
  { id: 'paste', label: 'Paste', icon: ClipboardPaste },
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'binding', label: 'Sign', icon: ShieldCheck },
  { id: 'confirmed', label: 'Done', icon: CheckCircle2 },
];

export function MultisigBindingCard({
  operatorId,
  walletAddress,
  onBound,
}: MultisigBindingCardProps): JSX.Element {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [multisigAddress, setMultisigAddress] = useState('');
  const [vaultIndex, setVaultIndex] = useState(0);
  const [label, setLabel] = useState('');
  const [snapshot, setSnapshot] = useState<MultisigSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>('paste');
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const trimmed = multisigAddress.trim();
  const canLookup = trimmed.length >= 32 && phase !== 'looking-up';
  const canBind =
    snapshot !== null && publicKey !== null && sendTransaction && phase !== 'binding';

  const stepIndex = useMemo<number>(() => {
    if (phase === 'paste' || phase === 'looking-up') return 0;
    if (phase === 'preview') return 1;
    if (phase === 'binding') return 2;
    return 3;
  }, [phase]);

  async function handleLookup(): Promise<void> {
    setPhase('looking-up');
    setError(null);
    setSnapshot(null);
    try {
      const res = await multisigApi.lookup(trimmed, vaultIndex);
      if (!res.data) throw new Error(res.error ?? 'Lookup returned no data');
      setSnapshot(res.data);
      setPhase('preview');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      setPhase('paste');
    }
  }

  async function handleBind(): Promise<void> {
    if (!publicKey || !sendTransaction || !snapshot) {
      setError('Wallet not ready');
      return;
    }
    setPhase('binding');
    setError(null);
    setSignature(null);
    try {
      const multisigPubkey = new PublicKey(snapshot.multisigAddress);
      const { instruction, vaultPda } = buildSetMultisigIx(
        publicKey,
        multisigPubkey,
        vaultIndex,
      );

      // Sanity guard against an RPC race: client and server vault PDAs must
      // match. If they don't, the operator probably looked up one vault
      // index but typed a different one — ask them to refresh the lookup.
      if (vaultPda.toBase58() !== snapshot.vaultPda) {
        throw new Error(
          `Vault PDA mismatch (client=${vaultPda.toBase58()} server=${snapshot.vaultPda}). Refresh the lookup and retry.`,
        );
      }

      const tx = new Transaction().add(instruction);
      tx.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const sig = await sendTransaction(tx, connection);
      setSignature(sig);
      await connection.confirmTransaction(sig, 'confirmed');

      const res = await multisigApi.bind({
        operator_id: operatorId,
        multisig_address: snapshot.multisigAddress,
        vault_index: vaultIndex,
        label: label.trim() || undefined,
        bind_tx_signature: sig,
        actor: walletAddress ?? publicKey.toBase58(),
      });
      if (!res.data?.binding) throw new Error('Binding cache missing in response');

      setPhase('confirmed');
      // Brief flash before the parent swaps in the overview card.
      setTimeout(() => onBound(res.data!.binding), 800);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bind failed');
      setPhase('preview');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Stepper currentStep={stepIndex} />

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
        <ApInput
          label="Squads multisig address"
          value={multisigAddress}
          onChange={(e) => {
            setMultisigAddress(e.target.value);
            setSnapshot(null);
            setPhase('paste');
          }}
          placeholder="Paste base58 pubkey"
          helper="An existing Squads V4 multisig you control."
        />
        <ApInput
          label="Vault index"
          type="number"
          min={0}
          max={255}
          value={String(vaultIndex)}
          onChange={(e) => {
            const n = Number(e.target.value);
            setVaultIndex(Number.isFinite(n) ? Math.max(0, Math.min(255, Math.floor(n))) : 0);
            setSnapshot(null);
            setPhase('paste');
          }}
          fieldClassName="sm:w-32"
          helper="0–255"
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={!canLookup}
          className="ap-btn-ghost-light inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed h-10"
        >
          {phase === 'looking-up' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          {phase === 'looking-up' ? 'Reading Solana…' : 'Look up'}
        </button>
      </div>

      <ApInput
        label="Label (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="e.g. Treasury 2-of-3"
        helper="Recorded in the audit log so multisigs are easy to tell apart."
      />

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {classifyError(error) === 'wallet'
              ? renderWalletHelp(error, multisigAddress.trim())
              : classifyError(error) === 'squads-v3'
                ? renderSquadsV3Help(error)
                : classifyError(error) === 'not-found'
                  ? renderNotFoundHelp(error, multisigAddress.trim())
                  : renderGenericError(error)}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {snapshot && phase !== 'confirmed' && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-4 rounded-[16px] border border-black/8 bg-[rgba(248,179,0,0.03)] p-4"
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </span>
                <span className="font-display text-[16px] tracking-[-0.005em] text-black">
                  Squads metadata
                </span>
              </div>
              <span className="inline-flex items-center rounded-pill bg-aperture/15 px-2.5 py-0.5 text-[11px] font-medium tracking-tighter text-aperture-dark">
                {snapshot.threshold} / {snapshot.members.length} threshold
              </span>
            </div>

            <ThresholdMeter
              threshold={snapshot.threshold}
              total={snapshot.members.length}
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <MetaCell label="Threshold" value={`${snapshot.threshold}`} accent />
              <MetaCell label="Members" value={`${snapshot.members.length}`} />
              <MetaCell label="Tx Index" value={`${snapshot.transactionIndex}`} />
            </div>

            <MembersList members={snapshot.members} currentWallet={walletAddress} />

            <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
                Vault PDA · Index #{vaultIndex}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-black break-all">
                {snapshot.vaultPda}
              </div>
            </div>

            <button
              type="button"
              onClick={handleBind}
              disabled={!canBind}
              className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed self-end"
            >
              {phase === 'binding' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {phase === 'binding' ? 'Signing set_multisig…' : 'Bind on-chain'}
            </button>

            <AnimatePresence>
              {signature && phase === 'binding' && (
                <motion.p
                  key="sig"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[11px] font-mono text-aperture-dark break-all"
                >
                  Tx submitted: {signature}
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {phase === 'confirmed' && (
          <motion.div
            key="confirmed"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col items-center gap-3 rounded-[16px] border border-green-500/25 bg-green-500/8 px-4 py-6"
          >
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-green-500/20 text-green-700"
            >
              <CheckCircle2 className="h-6 w-6" />
            </motion.span>
            <div className="text-center">
              <p className="font-display text-[18px] tracking-[-0.005em] text-green-700">
                Bound on Solana
              </p>
              <p className="text-[12px] text-black/55 tracking-tighter mt-1">
                Switching to the overview view…
              </p>
            </div>
          </motion.div>
        )}

        {!snapshot && phase === 'paste' && (
          <motion.div
            key="hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-[14px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-2.5"
          >
            <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-aperture-dark" />
            <div className="text-[12px] text-black/65 tracking-tighter flex-1">
              <p>
                Aperture only supports binding to a multisig that already exists.
                Create one in the{' '}
                <a
                  href={apertureConfig.squadsAppBaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-aperture-dark hover:text-black"
                >
                  Squads app
                </a>{' '}
                first, then paste its address here.
              </p>
              <p className="mt-1 text-black/45">
                Squads program ID:{' '}
                <a
                  href={apertureConfig.explorerUrl(
                    'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-aperture-dark hover:text-black"
                >
                  SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
                </a>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stepper({ currentStep }: { currentStep: number }): JSX.Element {
  return (
    <ol className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const isDone = index < currentStep;
        const isCurrent = index === currentStep;
        return (
          <li key={step.id} className="flex items-center gap-1.5 shrink-0">
            <motion.span
              animate={{
                background: isCurrent
                  ? 'rgba(248,179,0,0.15)'
                  : isDone
                    ? 'rgba(22,163,74,0.10)'
                    : 'rgba(0,0,0,0.05)',
                color: isCurrent ? '#c98f00' : isDone ? '#16a34a' : '#7c8293',
                scale: isCurrent ? 1.05 : 1,
              }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-[11px] font-medium tracking-tighter"
            >
              <Icon className="h-3 w-3" />
              <span>
                {index + 1}. {step.label}
              </span>
            </motion.span>
            {index < STEPS.length - 1 && (
              <motion.span
                animate={{ opacity: isDone ? 1 : 0.4 }}
                className="h-px w-6 bg-black/15"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ThresholdMeter({
  threshold,
  total,
}: {
  threshold: number;
  total: number;
}): JSX.Element {
  const ratio = total > 0 ? threshold / total : 0;
  return (
    <div
      className="flex items-center gap-1.5"
      title={`${threshold} of ${total} signatures required`}
      aria-label={`Threshold ${threshold} of ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const filled = i < threshold;
        return (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{
              opacity: 1,
              scale: 1,
              background: filled ? '#f8b300' : 'rgba(0,0,0,0.08)',
            }}
            transition={{
              duration: 0.4,
              delay: i * 0.04,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="block h-2 w-6 rounded-pill"
          />
        );
      })}
      <span className="ml-2 text-[11px] font-mono text-black/65">
        {Math.round(ratio * 100)}% threshold
      </span>
    </div>
  );
}

function MetaCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div
      className={`rounded-[12px] border px-3 py-2 ${
        accent
          ? 'border-aperture/40 bg-[rgba(248,179,0,0.08)]'
          : 'border-black/8 bg-white'
      }`}
    >
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-[14px] tracking-tighter ${accent ? 'text-aperture-dark' : 'text-black'}`}>
        {value}
      </div>
    </div>
  );
}

// -- Error classifiers + targeted help renderers ---------------------
//
// The policy-service returns 422 with a long human-readable message when
// the lookup hits an account that exists but isn't owned by Squads V4.
// We pattern-match on a few well-known phrases to render help that
// actually solves the operator's problem instead of a red pill that
// just says "no".

type ErrorKind = 'wallet' | 'squads-v3' | 'not-found' | 'generic';

function classifyError(message: string): ErrorKind {
  const lower = message.toLowerCase();
  if (lower.includes('regular wallet') || lower.includes('system program')) {
    return 'wallet';
  }
  if (lower.includes('squads v3')) {
    return 'squads-v3';
  }
  if (lower.includes('not found on solana')) {
    return 'not-found';
  }
  return 'generic';
}

function renderWalletHelp(message: string, pasted: string): JSX.Element {
  return (
    <div className="rounded-[14px] border border-aperture/35 bg-[rgba(248,179,0,0.06)] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-aperture-dark" />
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium tracking-tighter text-black">
            That looks like a wallet address, not a multisig
          </p>
          <p className="text-[12px] text-black/65 tracking-tighter">
            The address you pasted is owned by the System Program, which is what holds
            regular Phantom / Solflare wallets. A Squads V4 multisig is a separate PDA
            that you create at {squadsHost()} and that lives on-chain under the Squads
            program.
          </p>
        </div>
      </div>
      {pasted && (
        <code className="rounded-[10px] border border-black/8 bg-white px-3 py-2 text-[11px] font-mono text-black/65 break-all">
          {pasted}
        </code>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={apertureConfig.squadsAppBaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ap-btn-orange inline-flex items-center gap-1.5"
        >
          <ExternalLinkIcon />
          Create a multisig in Squads
        </a>
        <a
          href="https://docs.squads.so/main/development/squads-program"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-aperture-dark hover:border-aperture/40 transition-colors"
        >
          <ExternalLinkIcon />
          What is a multisig?
        </a>
      </div>
      <details className="text-[11px] text-black/55">
        <summary className="cursor-pointer hover:text-black">Server response</summary>
        <p className="mt-1 break-all">{message}</p>
      </details>
    </div>
  );
}

function renderSquadsV3Help(message: string): JSX.Element {
  return (
    <div className="rounded-[14px] border border-red-500/30 bg-red-500/5 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium tracking-tighter text-red-700">
            Squads V3 multisig detected
          </p>
          <p className="text-[12px] text-black/65 tracking-tighter">
            Aperture only integrates with Squads V4. V3 multisigs use a different
            program ID and cannot sign the policy registry instructions. Create a fresh
            V4 multisig at {squadsHost()} (V3 is in maintenance mode) and bind that
            instead.
          </p>
        </div>
      </div>
      <a
        href={apertureConfig.squadsAppBaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ap-btn-orange inline-flex items-center gap-1.5 self-start"
      >
        <ExternalLinkIcon />
        Open Squads (V4)
      </a>
      <details className="text-[11px] text-black/55">
        <summary className="cursor-pointer hover:text-black">Server response</summary>
        <p className="mt-1 break-all">{message}</p>
      </details>
    </div>
  );
}

function renderNotFoundHelp(message: string, pasted: string): JSX.Element {
  return (
    <div className="rounded-[14px] border border-aperture/35 bg-[rgba(248,179,0,0.06)] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-aperture-dark" />
        <div className="flex flex-col gap-1">
          <p className="text-[13px] font-medium tracking-tighter text-black">
            That account doesn&apos;t exist on this cluster
          </p>
          <p className="text-[12px] text-black/65 tracking-tighter">
            Aperture is currently looking at <strong>Solana Devnet</strong>. If your
            multisig lives on Mainnet, switch your wallet to Devnet and create a fresh
            multisig there for testing — multisigs cannot be moved across clusters.
          </p>
        </div>
      </div>
      {pasted && (
        <code className="rounded-[10px] border border-black/8 bg-white px-3 py-2 text-[11px] font-mono text-black/65 break-all">
          {pasted}
        </code>
      )}
      <details className="text-[11px] text-black/55">
        <summary className="cursor-pointer hover:text-black">Server response</summary>
        <p className="mt-1 break-all">{message}</p>
      </details>
    </div>
  );
}

function renderGenericError(message: string): JSX.Element {
  return (
    <div className="flex items-start gap-2 rounded-[14px] border border-red-500/30 bg-red-500/5 px-3 py-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
      <p className="text-[12px] tracking-tighter text-red-700 break-all">{message}</p>
    </div>
  );
}

function squadsHost(): string {
  return apertureConfig.squadsAppBaseUrl.replace(/^https?:\/\//, '');
}

function ExternalLinkIcon(): JSX.Element {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
