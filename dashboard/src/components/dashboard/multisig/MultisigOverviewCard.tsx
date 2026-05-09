'use client';

/**
 * MultisigOverviewCard — bound state. Surfaces threshold, vault PDA,
 * members, audit timestamps, plus the off-chain ledger actions
 * (sync / unbind). Built around framer-motion: the threshold meter fills
 * in on mount, member rows stagger in, the success / error states fade.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Loader2,
  RefreshCw,
  Unlink,
  ExternalLink,
  ShieldCheck,
  Users,
  Anchor,
  Clock,
} from 'lucide-react';
import { config } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';
import { multisigApi, type MultisigBinding } from '@/lib/api';
import { CopyableField } from '../shared/CopyableField';
import { MembersList } from './MembersList';

interface MultisigOverviewCardProps {
  readonly binding: MultisigBinding;
  readonly walletAddress: string | null;
  readonly onUpdate: (next: MultisigBinding | null) => void;
}

export function MultisigOverviewCard({
  binding,
  walletAddress,
  onUpdate,
}: MultisigOverviewCardProps): JSX.Element {
  const [syncing, setSyncing] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState(false);

  async function handleSync(): Promise<void> {
    if (!walletAddress) {
      setError('Connect your wallet to sync the multisig.');
      return;
    }
    setSyncing(true);
    setError(null);
    try {
      const res = await multisigApi.sync(binding.operatorId, walletAddress);
      if (res.data?.binding) onUpdate(res.data.binding);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function handleUnbind(): Promise<void> {
    if (!walletAddress) {
      setError('Connect your wallet to remove the binding.');
      return;
    }
    setUnbinding(true);
    setError(null);
    try {
      await multisigApi.unbind(binding.operatorId, walletAddress);
      onUpdate(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unbind failed');
    } finally {
      setUnbinding(false);
      setConfirmUnbind(false);
    }
  }

  return (
    <motion.div
      className="flex flex-col gap-5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat
          label="Threshold"
          value={`${binding.threshold} / ${binding.memberCount}`}
          icon={Users}
          accent
          delay={0}
        />
        <Stat
          label="Vault Index"
          value={`#${binding.vaultIndex}`}
          icon={ShieldCheck}
          delay={0.08}
        />
        <Stat
          label="Last Synced"
          value={
            binding.lastSyncedAt
              ? relativeTime(binding.lastSyncedAt)
              : 'never'
          }
          icon={Clock}
          delay={0.16}
        />
      </div>

      <ThresholdRow threshold={binding.threshold} total={binding.memberCount} />

      <div className="grid grid-cols-1 gap-3">
        <CopyableField
          label="Multisig address"
          value={binding.multisigAddress}
          display={
            <a
              href={config.explorerUrl(binding.multisigAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
            >
              {truncateAddress(binding.multisigAddress, 8)}
              <ExternalLink className="h-3 w-3" />
            </a>
          }
        />
        <CopyableField
          label="Vault PDA (signer)"
          value={binding.vaultPda}
          display={
            <a
              href={config.explorerUrl(binding.vaultPda)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
            >
              {truncateAddress(binding.vaultPda, 8)}
              <ExternalLink className="h-3 w-3" />
            </a>
          }
          helper="The address policy-registry expects to see as signer for register_policy_multisig and update_policy_multisig."
        />
        {binding.bindTxSignature && (
          <CopyableField
            label="Bind transaction"
            value={binding.bindTxSignature}
            display={
              <a
                href={config.txExplorerUrl(binding.bindTxSignature)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-aperture-dark hover:text-black transition-colors"
              >
                {truncateAddress(binding.bindTxSignature, 12)}
                <ExternalLink className="h-3 w-3" />
              </a>
            }
          />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.08em] text-black/55">
            Members
          </span>
          <span className="text-[11px] text-black/55 tracking-tighter">
            {binding.memberCount} signer{binding.memberCount === 1 ? '' : 's'}
          </span>
        </div>
        <MembersList members={binding.members} currentWallet={walletAddress} />
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            key="err"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-[12px] border border-red-500/25 bg-red-500/5 px-3 py-2.5 text-[12px] text-red-700 tracking-tighter"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-black/8">
        <a
          href={config.multisigViewerUrl(binding.multisigAddress)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-aperture-dark hover:border-aperture/40 transition-colors"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {config.multisigViewerIsExplorer ? 'View on Explorer' : 'Open in Squads'}
        </a>

        <motion.button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          whileTap={{ scale: 0.97 }}
          className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-black hover:border-aperture/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Sync from Solana
        </motion.button>

        <AnimatePresence mode="wait">
          {confirmUnbind ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="inline-flex items-center gap-1.5 rounded-pill border border-red-500/30 bg-red-500/8 pl-3 pr-1.5 py-1"
            >
              <span className="text-[12px] font-medium tracking-tighter text-red-700">
                Remove binding?
              </span>
              <button
                type="button"
                onClick={handleUnbind}
                disabled={unbinding}
                className="inline-flex items-center gap-1 rounded-pill bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-500/25 transition-colors disabled:opacity-50"
              >
                {unbinding && <Loader2 className="h-3 w-3 animate-spin" />}
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmUnbind(false)}
                disabled={unbinding}
                className="inline-flex items-center rounded-pill bg-black/5 px-2 py-0.5 text-[11px] font-medium text-black/65 hover:bg-black/10 transition-colors"
              >
                Cancel
              </button>
            </motion.div>
          ) : (
            <motion.button
              key="unbind"
              type="button"
              onClick={() => setConfirmUnbind(true)}
              initial={{ opacity: 0, x: 4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="inline-flex items-center gap-1.5 rounded-pill border border-red-500/25 bg-red-500/5 px-3 py-1.5 text-[12px] font-medium tracking-tighter text-red-700 hover:bg-red-500/10 transition-colors ml-auto"
            >
              <Unlink className="h-3.5 w-3.5" />
              Remove binding
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <p className="text-[11px] text-black/55 tracking-tighter">
        Removing the binding only clears the off-chain cache. The on-chain
        OperatorAccount still points at this vault; submit a new set_multisig
        instruction to rotate it.
      </p>

      <p className="text-[12px] text-black/65 tracking-tighter inline-flex items-center gap-1.5">
        <Anchor className="h-3.5 w-3.5 text-green-600 shrink-0" />
        Bound on {new Date(binding.boundAt).toLocaleString()}
      </p>
    </motion.div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  accent,
  delay = 0,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  accent?: boolean;
  delay?: number;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-[12px] border px-3 py-2.5 flex items-start gap-2.5 ${
        accent
          ? 'border-aperture/40 bg-[rgba(248,179,0,0.06)]'
          : 'border-black/8 bg-white'
      }`}
    >
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-pill shrink-0"
        style={{
          background: accent ? 'rgba(248,179,0,0.18)' : 'rgba(0,0,0,0.05)',
          color: accent ? '#c98f00' : '#596075',
        }}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
          {label}
        </div>
        <div
          className={`mt-0.5 font-display text-[20px] tracking-[-0.005em] ${
            accent ? 'text-aperture-dark' : 'text-black'
          }`}
        >
          {value}
        </div>
      </div>
    </motion.div>
  );
}

function ThresholdRow({
  threshold,
  total,
}: {
  threshold: number;
  total: number;
}): JSX.Element {
  return (
    <div className="rounded-[14px] border border-black/8 bg-[rgba(248,179,0,0.04)] px-3 py-2.5 flex items-center gap-3 flex-wrap">
      <span className="text-[11px] uppercase tracking-[0.08em] text-black/55 shrink-0">
        Approval bar
      </span>
      <div className="flex items-center gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
            className="block h-2.5 w-6 rounded-pill"
            style={{ background: i < threshold ? '#f8b300' : 'rgba(0,0,0,0.08)' }}
          />
        ))}
      </div>
      <span className="ml-auto text-[11px] font-mono text-black/65">
        {threshold} of {total} signers required
      </span>
    </div>
  );
}

function relativeTime(date: string): string {
  const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 30) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
