'use client';

/**
 * MultisigOverviewCard — shown when the operator already has a Squads
 * binding. Surfaces threshold, vault PDA, members, audit timestamps, and
 * the off-chain ledger actions (sync / unbind).
 */

import { useState } from 'react';
import {
  CheckCircle,
  Loader2,
  RefreshCw,
  Unlink,
  ExternalLink,
  ShieldCheck,
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
}: MultisigOverviewCardProps) {
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
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat
          label="Threshold"
          value={`${binding.threshold} / ${binding.memberCount}`}
          accent
        />
        <Stat
          label="Vault Index"
          value={`#${binding.vaultIndex}`}
        />
        <Stat
          label="Last Synced"
          value={
            binding.lastSyncedAt
              ? relativeTime(binding.lastSyncedAt)
              : 'never'
          }
        />
      </div>

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

      {error && (
        <div className="rounded-[12px] border border-red-500/25 bg-red-500/5 px-3 py-2.5 text-[12px] text-red-700 tracking-tighter">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-black/8">
        <a
          href={`https://app.squads.so/squads/${binding.multisigAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-aperture-dark hover:border-aperture/40 transition-colors"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Open in Squads
        </a>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 rounded-pill border border-black/8 bg-white px-3 py-1.5 text-[12px] font-medium tracking-tighter text-black hover:border-aperture/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Sync from Solana
        </button>

        {confirmUnbind ? (
          <div className="inline-flex items-center gap-1.5 rounded-pill border border-red-500/30 bg-red-500/8 pl-3 pr-1.5 py-1">
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
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmUnbind(true)}
            className="inline-flex items-center gap-1.5 rounded-pill border border-red-500/25 bg-red-500/5 px-3 py-1.5 text-[12px] font-medium tracking-tighter text-red-700 hover:bg-red-500/10 transition-colors ml-auto"
          >
            <Unlink className="h-3.5 w-3.5" />
            Remove binding
          </button>
        )}
      </div>

      <p className="text-[11px] text-black/55 tracking-tighter">
        Removing the binding only clears the off-chain cache. The on-chain
        OperatorAccount still points at this vault; submit a new set_multisig
        instruction in the binding card below to rotate it.
      </p>

      <p className="text-[12px] text-black/65 tracking-tighter inline-flex items-center gap-1.5">
        <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
        Bound on {new Date(binding.boundAt).toLocaleString()}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-[12px] border px-3 py-2.5 ${
        accent
          ? 'border-aperture/40 bg-[rgba(248,179,0,0.06)]'
          : 'border-black/8 bg-white'
      }`}
    >
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
