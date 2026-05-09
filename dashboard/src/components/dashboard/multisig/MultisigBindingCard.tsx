'use client';

/**
 * MultisigBindingCard — the unbound state. Lets the operator paste an
 * existing Squads V4 multisig address, choose a vault index, preview the
 * threshold + members from RPC, and submit set_multisig with their
 * connected wallet.
 *
 * Flow:
 *   1. Paste address + pick vault index
 *   2. Click "Look up" → policy-service fetches Squads metadata via RPC
 *   3. Confirm members + threshold preview
 *   4. Click "Bind on-chain" → wallet signs set_multisig instruction
 *   5. Confirm signature → policy-service caches the binding
 *
 * The wallet client always submits the on-chain transaction first; the
 * off-chain cache is updated only after the tx is confirmed. This keeps
 * the cache and chain consistent under partial failure.
 */

import { useState } from 'react';
import {
  Loader2,
  Search,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
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

type Phase = 'idle' | 'looking-up' | 'previewing' | 'binding' | 'confirmed';

export function MultisigBindingCard({
  operatorId,
  walletAddress,
  onBound,
}: MultisigBindingCardProps) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [multisigAddress, setMultisigAddress] = useState('');
  const [vaultIndex, setVaultIndex] = useState(0);
  const [label, setLabel] = useState('');
  const [snapshot, setSnapshot] = useState<MultisigSnapshot | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const canLookup = multisigAddress.trim().length >= 32 && phase !== 'looking-up';
  const canBind =
    snapshot !== null && publicKey !== null && sendTransaction && phase !== 'binding';

  async function handleLookup(): Promise<void> {
    setPhase('looking-up');
    setError(null);
    setSnapshot(null);
    try {
      const res = await multisigApi.lookup(multisigAddress.trim(), vaultIndex);
      if (!res.data) throw new Error(res.error ?? 'Lookup returned no data');
      setSnapshot(res.data);
      setPhase('previewing');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      setPhase('idle');
    }
  }

  async function handleBind(): Promise<void> {
    if (!publicKey || !sendTransaction || !snapshot) {
      setError('Wallet not ready');
      return;
    }
    setPhase('binding');
    setError(null);
    try {
      const multisigPubkey = new PublicKey(snapshot.multisigAddress);
      const { instruction, vaultPda } = buildSetMultisigIx(
        publicKey,
        multisigPubkey,
        vaultIndex,
      );

      // Sanity: the vault PDA we derive client-side must equal the one the
      // policy-service derived against the RPC-loaded multisig. This guards
      // against an RPC race where the operator looked up one vault but the
      // dashboard derives another.
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
      onBound(res.data.binding);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bind failed');
      setPhase('previewing');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <ApInput
          label="Squads multisig address"
          value={multisigAddress}
          onChange={(e) => {
            setMultisigAddress(e.target.value);
            setSnapshot(null);
            setPhase('idle');
          }}
          placeholder="e.g. BSAinHGE…"
          helper="Base58 pubkey of an existing Squads V4 multisig you control."
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
            setPhase('idle');
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
        helper="Helps you tell multisigs apart in the audit log."
      />

      {error && (
        <div className="flex items-start gap-2 rounded-[14px] border border-red-500/30 bg-red-500/5 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" />
          <p className="text-[12px] tracking-tighter text-red-700 break-all">{error}</p>
        </div>
      )}

      {snapshot && (
        <div className="flex flex-col gap-4 rounded-[16px] border border-black/8 bg-[rgba(248,179,0,0.03)] p-4">
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

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <MetaCell label="Threshold" value={`${snapshot.threshold}`} />
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
        </div>
      )}

      {!snapshot && (
        <div className="flex items-start gap-2 rounded-[14px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-2.5">
          <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-aperture-dark" />
          <div className="text-[12px] text-black/65 tracking-tighter flex-1">
            <p>
              Aperture only supports binding to a multisig that already exists.
              Create one in the{' '}
              <a
                href="https://app.squads.so/"
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
        </div>
      )}
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-black/8 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-black/55">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] text-black tracking-tighter">
        {value}
      </div>
    </div>
  );
}
