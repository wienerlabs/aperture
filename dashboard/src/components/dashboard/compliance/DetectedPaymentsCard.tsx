'use client';

/**
 * DetectedPaymentsCard - shows every payment the compliance watcher has
 * recorded for the operator wallet (Solana SPL transfers via Helius +
 * verified Stripe PaymentIntents) alongside its attestation status:
 *
 *   - "proof"      : a proof_records row matched the tx/PI
 *   - "open"       : watcher detected the payment but no proof anchored it
 *   - "justified"  : operator marked the unattested payment as expected
 *   - "dismissed"  : operator marked it as a false positive / out of scope
 *
 * The card is the primary surface for adverse-action detection: a regulator
 * sees the full payment list with no hidden bypass paths.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  X,
} from 'lucide-react';
import {
  complianceApi,
  unattestedApi,
  type ProofRecord,
  type UnattestedPayment,
  type UnattestedStatus,
} from '@/lib/api';
import { config } from '@/lib/config';
import { truncateAddress, formatAmount } from '@/lib/utils';
import { useWallet } from '@solana/wallet-adapter-react';
import { getStripeDashboardUrl } from '@/lib/mpp-client';

interface DetectedRowAttested {
  readonly kind: 'attested';
  readonly key: string;
  readonly source: 'solana' | 'stripe';
  readonly identifier: string;
  readonly counterparty: string | null;
  readonly asset: string;
  readonly amountDisplay: string;
  readonly explorerUrl: string | null;
  readonly stripeUrl: string | null;
  readonly timestamp: string;
}

interface DetectedRowUnattested {
  readonly kind: 'unattested';
  readonly key: string;
  readonly record: UnattestedPayment;
  readonly explorerUrl: string | null;
  readonly stripeUrl: string | null;
}

type DetectedRow = DetectedRowAttested | DetectedRowUnattested;

const REFRESH_INTERVAL_MS = 10_000;

interface DetectedPaymentsCardProps {
  readonly operatorId: string;
  readonly attestedProofs: readonly ProofRecord[];
}

export function DetectedPaymentsCard({
  operatorId,
  attestedProofs,
}: DetectedPaymentsCardProps) {
  const { publicKey } = useWallet();
  const [unattested, setUnattested] = useState<readonly UnattestedPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | UnattestedStatus | 'attested'>('all');
  const [resolveBusyId, setResolveBusyId] = useState<string | null>(null);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [resolveDialog, setResolveDialog] = useState<{
    readonly id: string;
    readonly status: 'justified' | 'dismissed';
    readonly record: UnattestedPayment;
  } | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const fetchUnattested = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        const res = await unattestedApi.list({
          operator_id: operatorId,
          status: 'all',
          page: 1,
          limit: 100,
        });
        setUnattested(res.data);
        setError(null);
      } catch (err) {
        if (showSpinner) {
          setError(err instanceof Error ? err.message : 'Failed to load detected payments');
        }
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [operatorId],
  );

  useEffect(() => {
    fetchUnattested(true);
    const interval = setInterval(() => fetchUnattested(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchUnattested]);

  const rows: readonly DetectedRow[] = useMemo(() => {
    const attested: DetectedRow[] = attestedProofs.map((p) => {
      const isStripe = p.payment_id.startsWith('pi_');
      const sig = p.tx_signature;
      return {
        kind: 'attested',
        key: `attested-${p.id}`,
        source: isStripe ? 'stripe' : 'solana',
        identifier: isStripe ? p.payment_id : sig ?? p.payment_id,
        counterparty: null,
        asset: p.token_mint,
        amountDisplay: `${formatAmount(p.amount_range_min)} - ${formatAmount(p.amount_range_max)}`,
        explorerUrl: sig ? config.txExplorerUrl(sig) : null,
        stripeUrl: isStripe ? getStripeDashboardUrl(p.payment_id, true) : null,
        timestamp: p.verified_at ?? p.created_at,
      };
    });

    const unattestedRows: DetectedRow[] = unattested.map((u) => ({
      kind: 'unattested',
      key: `unattested-${u.id}`,
      record: u,
      explorerUrl: u.source === 'solana' ? config.txExplorerUrl(u.identifier) : null,
      stripeUrl: u.source === 'stripe' ? getStripeDashboardUrl(u.identifier, true) : null,
    }));

    const combined = [...attested, ...unattestedRows];
    combined.sort((a, b) => {
      const tA =
        a.kind === 'attested'
          ? new Date(a.timestamp).getTime()
          : new Date(a.record.detected_at).getTime();
      const tB =
        b.kind === 'attested'
          ? new Date(b.timestamp).getTime()
          : new Date(b.record.detected_at).getTime();
      return tB - tA;
    });
    return combined;
  }, [attestedProofs, unattested]);

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'attested') return rows.filter((r) => r.kind === 'attested');
    return rows.filter((r) => r.kind === 'unattested' && r.record.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const open = unattested.filter((u) => u.status === 'open').length;
    const justified = unattested.filter((u) => u.status === 'justified').length;
    const dismissed = unattested.filter((u) => u.status === 'dismissed').length;
    return {
      attested: attestedProofs.length,
      open,
      justified,
      dismissed,
    };
  }, [attestedProofs, unattested]);

  const openResolveDialog = useCallback(
    (record: UnattestedPayment, status: 'justified' | 'dismissed') => {
      if (!publicKey) {
        setError('Connect a wallet to resolve detected payments.');
        return;
      }
      setResolveNote('');
      setResolveDialog({ id: record.id, status, record });
    },
    [publicKey],
  );

  const closeResolveDialog = useCallback(() => {
    setResolveDialog(null);
    setResolveNote('');
  }, []);

  const submitResolve = useCallback(async () => {
    if (!resolveDialog || !publicKey) return;
    setResolveBusyId(resolveDialog.id);
    try {
      const trimmed = resolveNote.trim();
      await unattestedApi.resolve(resolveDialog.id, {
        status: resolveDialog.status,
        resolved_by: publicKey.toBase58(),
        note: trimmed.length > 0 ? trimmed : undefined,
      });
      await fetchUnattested(false);
      closeResolveDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve payment');
    } finally {
      setResolveBusyId(null);
    }
  }, [resolveDialog, publicKey, resolveNote, fetchUnattested, closeResolveDialog]);

  const refreshAttested = useCallback(async () => {
    if (!operatorId) return;
    try {
      // Fire and forget - the parent component owns the proofs list, but we
      // still trigger a refresh in case the reconcile action created any
      // implicit proof links downstream. The light side-effect is harmless.
      await complianceApi.listProofsByOperator(operatorId, 1, 1);
    } catch {
      // Ignore - the parent's polling will recover.
    }
  }, [operatorId]);

  const handleManualReconcile = useCallback(async () => {
    setReconcileBusy(true);
    setError(null);
    try {
      await unattestedApi.reconcile();
      await Promise.all([fetchUnattested(false), refreshAttested()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconcile failed');
    } finally {
      setReconcileBusy(false);
    }
  }, [fetchUnattested, refreshAttested]);

  if (loading) {
    return (
      <div className="ap-card p-12 flex items-center justify-center">
        <Loader2 className="h-7 w-7 text-aperture animate-spin" />
      </div>
    );
  }

  return (
    <section className="ap-card overflow-hidden">
      <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-black/8">
        <div>
          <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
            Detected Payments
          </h3>
          <p className="text-[12px] text-black/55 tracking-tighter mt-1">
            Every SPL transfer + Stripe charge attached to this operator. Watcher
            cross-checks each one against proof_records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchUnattested(true)}
            className="ap-btn-ghost-light inline-flex items-center gap-1.5"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            type="button"
            onClick={handleManualReconcile}
            disabled={reconcileBusy}
            className="ap-btn-orange inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {reconcileBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="h-4 w-4" />
            )}
            Run scan
          </button>
        </div>
      </header>

      {error && (
        <div className="px-5 py-3 flex items-start gap-2 border-b border-black/8 bg-red-500/4">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-red-600 flex-shrink-0" />
          <p className="text-[13px] text-red-700 flex-1">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-black/45 hover:text-black"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b border-black/8">
        <FilterPill
          label={`All (${rows.length})`}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterPill
          label={`Proof (${counts.attested})`}
          tone="green"
          active={filter === 'attested'}
          onClick={() => setFilter('attested')}
        />
        <FilterPill
          label={`Open (${counts.open})`}
          tone={counts.open > 0 ? 'red' : 'neutral'}
          active={filter === 'open'}
          onClick={() => setFilter('open')}
        />
        <FilterPill
          label={`Justified (${counts.justified})`}
          tone="amber"
          active={filter === 'justified'}
          onClick={() => setFilter('justified')}
        />
        <FilterPill
          label={`Dismissed (${counts.dismissed})`}
          active={filter === 'dismissed'}
          onClick={() => setFilter('dismissed')}
        />
      </div>

      {filteredRows.length === 0 ? (
        <div className="px-5 py-12 flex flex-col items-center text-center gap-2">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
            <CheckCircle className="h-5 w-5" />
          </span>
          <p className="text-[14px] tracking-tighter text-black">
            No payments in this filter
          </p>
          <p className="text-[12px] text-black/55 tracking-tighter">
            Watcher polls every {Math.round(15_000 / 1000)}s. Run scan now to force a
            cycle.
          </p>
        </div>
      ) : (
        <ol className="divide-y divide-black/8 max-h-[640px] overflow-y-auto">
          {filteredRows.map((row) => (
            <li key={row.key} className="px-5 py-3">
              {row.kind === 'attested' ? (
                <AttestedRow row={row} />
              ) : (
                <UnattestedRow
                  row={row}
                  busy={resolveBusyId === row.record.id}
                  onResolve={openResolveDialog}
                />
              )}
            </li>
          ))}
        </ol>
      )}

      {resolveDialog && (
        <ResolveDialog
          dialog={resolveDialog}
          note={resolveNote}
          busy={resolveBusyId === resolveDialog.id}
          onChangeNote={setResolveNote}
          onCancel={closeResolveDialog}
          onConfirm={submitResolve}
        />
      )}
    </section>
  );
}

interface ResolveDialogProps {
  readonly dialog: { readonly id: string; readonly status: 'justified' | 'dismissed'; readonly record: UnattestedPayment };
  readonly note: string;
  readonly busy: boolean;
  readonly onChangeNote: (value: string) => void;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

function ResolveDialog({
  dialog,
  note,
  busy,
  onChangeNote,
  onCancel,
  onConfirm,
}: ResolveDialogProps) {
  const isJustify = dialog.status === 'justified';
  const titleCopy = isJustify ? 'Justify detected payment' : 'Dismiss detected payment';
  const intentCopy = isJustify
    ? 'Mark this payment as expected. The audit log records who approved it and why.'
    : 'Mark this payment as out of scope (false positive, irrelevant to compliance).';
  const ctaCopy = isJustify ? 'Justify' : 'Dismiss';
  const placeholderCopy = isJustify
    ? 'Why is this payment expected? (e.g. manual rebalancing, retry after agent crash)'
    : 'Why dismiss this payment? (e.g. test data, pre-watcher transfer)';

  // Close on Escape so the modal feels native to the dashboard rather than
  // requiring a mouse trip back to Cancel.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, onCancel]);

  const r = dialog.record;
  const amountDisplay = formatRawAmount(r.amount_raw, r.source, r.asset);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center px-4"
      onClick={busy ? undefined : onCancel}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-md rounded-[20px] p-6"
        style={{
          backgroundColor: '#ffffff',
          boxShadow:
            'rgba(101, 69, 0, 0.06) 0px 32px 56px -16px, rgba(101, 69, 0, 0.04) 0px 8px 16px -4px, rgba(101, 69, 0, 0.10) 0px 0px 0px 1px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-display text-[20px] font-semibold text-black">
              {titleCopy}
            </h3>
            <p className="text-[13px] text-black/55 tracking-tighter mt-1">{intentCopy}</p>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-black/45 hover:text-black"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <dl className="grid grid-cols-2 gap-2 mb-4 rounded-[12px] border border-black/8 bg-[rgba(248,179,0,0.04)] px-3 py-2.5">
          <DialogCell label="Source" value={r.source.toUpperCase()} />
          <DialogCell label="Amount" value={amountDisplay} />
          <DialogCell
            label={r.source === 'solana' ? 'Recipient' : 'Customer'}
            value={r.counterparty ? truncateAddress(r.counterparty, 6) : 'unknown'}
            mono
          />
          <DialogCell
            label={r.source === 'solana' ? 'Tx Signature' : 'PaymentIntent'}
            value={truncateAddress(r.identifier, 6)}
            mono
          />
        </dl>

        <label className="block text-[12px] uppercase tracking-[0.08em] text-black/55 mb-1.5">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => onChangeNote(e.target.value)}
          placeholder={placeholderCopy}
          rows={3}
          disabled={busy}
          className="w-full resize-none rounded-[12px] border border-black/12 bg-white px-3 py-2 text-[14px] text-black outline-none focus:border-aperture/50 disabled:opacity-50"
        />

        <div className="flex justify-end items-center gap-3 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="ap-btn-ghost-light disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="ap-btn-orange inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Saving...' : ctaCopy}
          </button>
        </div>
      </div>
    </div>
  );
}

function DialogCell({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.08em] text-black/55">{label}</div>
      <div className={`text-[13px] text-black mt-0.5 break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: 'red' | 'green' | 'amber' | 'neutral';
  onClick: () => void;
}) {
  const inactiveColors =
    tone === 'red'
      ? 'border-red-500/30 text-red-700 bg-red-500/8'
      : tone === 'green'
        ? 'border-green-600/30 text-green-700 bg-green-600/8'
        : tone === 'amber'
          ? 'border-aperture/30 text-aperture-dark bg-aperture/8'
          : 'border-black/12 text-black/65 bg-white';
  const activeColors = 'border-black bg-black text-white';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-[12px] tracking-tighter transition-colors ${
        active ? activeColors : inactiveColors
      }`}
    >
      {label}
    </button>
  );
}

function AttestedRow({ row }: { row: DetectedRowAttested }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className="inline-flex items-center gap-1 rounded-pill bg-green-600/12 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em] text-green-700">
          <ShieldCheck className="h-3 w-3" />
          proof
        </span>
        <span className="text-[12px] text-black/55 uppercase tracking-[0.04em]">
          {row.source}
        </span>
        <span className="text-[13px] tracking-tighter text-black truncate min-w-0">
          {row.amountDisplay} {tokenLabel(row.asset)}
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="font-mono text-[11px] text-black/55">
          {truncateAddress(row.identifier, 6)}
        </span>
        {row.explorerUrl && (
          <a
            href={row.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-aperture-dark hover:text-black"
          >
            <ExternalLink className="h-3 w-3" />
            Tx
          </a>
        )}
        {row.stripeUrl && (
          <a
            href={row.stripeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-aperture-dark hover:text-black"
          >
            <ExternalLink className="h-3 w-3" />
            Stripe
          </a>
        )}
        <span className="text-[11px] text-black/55 w-20 text-right">
          {relativeTime(row.timestamp)}
        </span>
      </div>
    </div>
  );
}

function UnattestedRow({
  row,
  busy,
  onResolve,
}: {
  row: DetectedRowUnattested;
  busy: boolean;
  onResolve: (record: UnattestedPayment, status: 'justified' | 'dismissed') => void;
}) {
  const r = row.record;
  const tone = statusTone(r.status);
  const amountDisplay = formatRawAmount(r.amount_raw, r.source, r.asset);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span
            className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em]"
            style={{ background: tone.bg, color: tone.fg }}
          >
            <ShieldX className="h-3 w-3" />
            {r.status}
          </span>
          <span className="text-[12px] text-black/55 uppercase tracking-[0.04em]">
            {r.source}
          </span>
          <span className="text-[13px] tracking-tighter text-black truncate min-w-0">
            {amountDisplay} → {r.counterparty ? truncateAddress(r.counterparty, 6) : 'unknown'}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[11px] text-black/55">
            {truncateAddress(r.identifier, 6)}
          </span>
          {row.explorerUrl && (
            <a
              href={row.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-aperture-dark hover:text-black"
            >
              <ExternalLink className="h-3 w-3" />
              Tx
            </a>
          )}
          {row.stripeUrl && (
            <a
              href={row.stripeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-aperture-dark hover:text-black"
            >
              <ExternalLink className="h-3 w-3" />
              Stripe
            </a>
          )}
          <span className="text-[11px] text-black/55 w-20 text-right">
            {relativeTime(r.detected_at)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-1">
        <span className="text-[11px] text-black/55 tracking-tighter">
          Reason: <span className="font-mono">{r.reason}</span>
        </span>
        {r.justification_note && (
          <span className="text-[11px] text-black/55 tracking-tighter">
            Note: {r.justification_note}
          </span>
        )}
        {r.status === 'open' && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => onResolve(r, 'justified')}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-pill border border-aperture/40 bg-aperture/8 px-3 py-1 text-[12px] text-aperture-dark hover:bg-aperture/12 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Justify
            </button>
            <button
              type="button"
              onClick={() => onResolve(r, 'dismissed')}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-pill border border-black/15 bg-white px-3 py-1 text-[12px] text-black hover:bg-black/5 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function statusTone(status: UnattestedStatus): { bg: string; fg: string } {
  if (status === 'open') return { bg: 'rgba(220, 38, 38, 0.12)', fg: '#b91c1c' };
  if (status === 'justified') return { bg: 'rgba(248, 179, 0, 0.18)', fg: '#92400e' };
  return { bg: 'rgba(124, 130, 147, 0.14)', fg: '#475569' };
}

function tokenLabel(mint: string): string {
  const tokens = config.tokens;
  if (tokens.aUSDC && mint === tokens.aUSDC) return 'aUSDC';
  if (tokens.usdc && mint === tokens.usdc) return 'USDC';
  if (tokens.usdt && mint === tokens.usdt) return 'USDT';
  return truncateAddress(mint, 4);
}

function formatRawAmount(amountRaw: string, source: 'solana' | 'stripe', asset: string): string {
  if (source === 'stripe') {
    const cents = parseInt(amountRaw, 10);
    if (Number.isNaN(cents)) return `${amountRaw} ${asset.toUpperCase()}`;
    return `$${(cents / 100).toFixed(2)} ${asset.toUpperCase()}`;
  }
  // Solana: amount_raw is the smallest unit; SPL tokens here use 6 decimals
  // (USDC / USDT / aUSDC convention). Asset label uses the mint shorthand.
  const big = parseFloat(amountRaw);
  const decimals = 6;
  const human = big / 10 ** decimals;
  return `${human.toFixed(human < 1 ? 6 : 4)} ${tokenLabel(asset)}`;
}

function relativeTime(date: string): string {
  const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return new Date(date).toLocaleDateString();
}
