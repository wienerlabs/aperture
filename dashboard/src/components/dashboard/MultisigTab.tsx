'use client';

/**
 * MultisigTab — full-width Squads V4 governance surface.
 *
 * The Settings tab still hosts a small summary card that links here, but
 * binding lifecycle, member browsing, audit trail, and the flow guide all
 * live in this dedicated tab so an operator gets a single page to onboard
 * an existing Squads multisig and reason about who can change policy.
 */

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Users,
  Loader2,
  AlertTriangle,
  Wallet,
  ShieldCheck,
  Lock,
  ListChecks,
  ExternalLink,
} from 'lucide-react';
import { useOperatorId } from '@/hooks/useOperatorId';
import {
  multisigApi,
  type MultisigBinding,
  type MultisigAuditEntry,
} from '@/lib/api';
import { config } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';
import { MetricCard } from './overview/MetricCard';
import { MultisigBindingCard } from './multisig/MultisigBindingCard';
import { MultisigOverviewCard } from './multisig/MultisigOverviewCard';

const SQUADS_PROGRAM_ID = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

export function MultisigTab(): JSX.Element {
  const operatorId = useOperatorId();
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;

  const [binding, setBinding] = useState<MultisigBinding | null>(null);
  const [bindingLoading, setBindingLoading] = useState(true);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [audit, setAudit] = useState<readonly MultisigAuditEntry[]>([]);

  const loadAll = useCallback(async (): Promise<void> => {
    if (!operatorId) return;
    setBindingLoading(true);
    setBindingError(null);
    try {
      const result = await multisigApi.getBinding(operatorId);
      setBinding(result);
      const auditResult = await multisigApi.audit(operatorId, 25);
      setAudit(auditResult.data ?? []);
    } catch (err: unknown) {
      setBindingError(err instanceof Error ? err.message : 'Failed to load multisig');
    } finally {
      setBindingLoading(false);
    }
  }, [operatorId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  function handleBindingChange(next: MultisigBinding | null): void {
    setBinding(next);
    void loadAll();
  }

  if (!operatorId) {
    return (
      <div className="ap-card p-12 flex flex-col items-center text-center gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark">
          <Wallet className="h-6 w-6" />
        </span>
        <h2 className="font-display text-[24px] tracking-[-0.012em] text-black">
          Connect a wallet to manage multisig
        </h2>
        <p className="text-[14px] text-black/55 tracking-tighter max-w-md">
          Multisig binding is namespaced per operator wallet. Connect with Phantom or
          Solflare to bind a Squads V4 vault to your policies.
        </p>
      </div>
    );
  }

  const isBound = Boolean(binding);

  return (
    <div className="space-y-6">
      {/* Hero ribbon */}
      <section
        className="relative overflow-hidden rounded-[24px] border border-black/8 bg-white p-6 sm:p-8"
        style={{ boxShadow: 'var(--shadow-card)' }}
      >
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: isBound
              ? 'radial-gradient(ellipse 50% 70% at 95% 0%, rgba(22,163,74,0.18) 0%, rgba(22,163,74,0) 65%)'
              : 'radial-gradient(ellipse 50% 80% at 95% 10%, rgba(248,179,0,0.18) 0%, rgba(248,179,0,0) 65%)',
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-aperture/15 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark w-fit">
              <Users className="h-3 w-3" />
              Multisig Governance
            </span>
            <h1 className="font-display text-[36px] sm:text-[44px] leading-[1.04] tracking-[-0.012em] text-black">
              {isBound ? 'Multisig is active' : 'Bind a Squads multisig'}
            </h1>
            <p className="text-[14px] text-black/55 tracking-tighter max-w-2xl">
              {isBound
                ? 'Every register_policy and update_policy must be signed by your Squads vault. Single-wallet shortcuts are off.'
                : 'Aperture currently runs single-signer for this operator. Bind a Squads V4 multisig to require N-of-M approval on every policy change.'}
            </p>
          </div>

          <span
            className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[12px] font-medium tracking-tighter shrink-0"
            style={{
              color: isBound ? '#16a34a' : '#c98f00',
              background: isBound ? 'rgba(22,163,74,0.10)' : 'rgba(248,179,0,0.14)',
            }}
          >
            {isBound ? <Lock className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {isBound
              ? `${binding!.threshold} of ${binding!.memberCount} signers`
              : 'Single signer'}
          </span>
        </div>
      </section>

      {/* Stats row */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Binding"
          value={isBound ? 'Active' : 'Off'}
          icon={Lock}
          hint={isBound ? 'register/update gated' : 'Wallet signs directly'}
        />
        <MetricCard
          label="Threshold"
          value={isBound ? `${binding!.threshold} / ${binding!.memberCount}` : '—'}
          icon={Users}
          hint={
            isBound
              ? `${binding!.threshold} approval${binding!.threshold === 1 ? '' : 's'} required per change`
              : 'Bind to set a threshold'
          }
        />
        <MetricCard
          label="Vault Index"
          value={isBound ? `#${binding!.vaultIndex}` : '—'}
          icon={ShieldCheck}
          hint={isBound ? truncateAddress(binding!.vaultPda, 6) : 'Per-multisig sub-account'}
        />
        <MetricCard
          label="Audit Entries"
          value={audit.length.toLocaleString()}
          icon={ListChecks}
          hint="Bind / sync / unbind events recorded"
        />
      </section>

      {/* Top-level error */}
      {bindingError && (
        <div className="ap-card p-4 flex items-start gap-3" style={{ borderColor: '#fca5a5' }}>
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-600" />
          <p className="text-[13px] text-red-700 tracking-tighter">{bindingError}</p>
        </div>
      )}

      {/* Main lifecycle card */}
      {bindingLoading ? (
        <div className="ap-card p-12 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-aperture-dark" />
        </div>
      ) : isBound ? (
        <section className="ap-card p-6 sm:p-7">
          <header className="flex items-center justify-between gap-3 flex-wrap mb-5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-display text-[22px] tracking-[-0.005em] text-black">
                  Active Binding
                </h2>
                <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
                  Cached from on-chain at last sync. Unbind only after rotating with a
                  fresh set_multisig.
                </p>
              </div>
            </div>
          </header>
          <MultisigOverviewCard
            binding={binding!}
            walletAddress={walletAddress}
            onUpdate={handleBindingChange}
          />
        </section>
      ) : (
        <section className="ap-card p-6 sm:p-7">
          <header className="flex items-center gap-3 mb-5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
              <Users className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-[22px] tracking-[-0.005em] text-black">
                Bind an existing Squads multisig
              </h2>
              <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
                Paste the multisig address, pick a vault index, and confirm the
                set_multisig instruction with your wallet.
              </p>
            </div>
          </header>
          <MultisigBindingCard
            operatorId={operatorId}
            walletAddress={walletAddress}
            onBound={handleBindingChange}
          />
        </section>
      )}

      {/* Workflow guide — always visible so the operator knows what binding
          means before they sign anything. */}
      <section className="ap-card p-6 sm:p-7">
        <header className="mb-4">
          <h2 className="font-display text-[20px] tracking-[-0.005em] text-black">
            How it works
          </h2>
          <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
            Four steps from a new Squads multisig to a fully governed operator.
          </p>
        </header>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {WORKFLOW_STEPS.map((step, index) => (
            <li
              key={step.title}
              className="rounded-[14px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-4 py-3 flex flex-col gap-2"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-pill bg-aperture/15 text-aperture-dark text-[12px] font-medium">
                {index + 1}
              </span>
              <h3 className="font-display text-[15px] tracking-[-0.005em] text-black">
                {step.title}
              </h3>
              <p className="text-[12px] text-black/65 tracking-tighter">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Audit trail */}
      <section className="ap-card overflow-hidden">
        <header className="px-5 py-4 flex items-center justify-between border-b border-black/8">
          <div className="flex items-center gap-2.5">
            <ListChecks className="h-4 w-4 text-aperture-dark" />
            <h2 className="font-display text-[18px] tracking-[-0.005em] text-black">
              Audit Trail
            </h2>
          </div>
          <span className="inline-flex items-center rounded-pill bg-aperture/12 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark">
            {audit.length} entr{audit.length === 1 ? 'y' : 'ies'}
          </span>
        </header>
        {audit.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[13px] text-black/55 tracking-tighter">
              No multisig events for this operator yet. Binding, syncing, and unbinding
              all leave an audit row here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-black/8">
            {audit.map((entry) => (
              <li key={entry.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <span
                  className="inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.04em]"
                  style={ACTION_STYLE[entry.action]}
                >
                  {entry.action}
                </span>
                <span className="text-[12px] tracking-tighter text-black/65 font-mono">
                  {entry.actor.slice(0, 6)}…{entry.actor.slice(-4)}
                </span>
                {entry.multisigAddress && (
                  <a
                    href={config.explorerUrl(entry.multisigAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-mono text-aperture-dark hover:text-black transition-colors"
                  >
                    {truncateAddress(entry.multisigAddress, 6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {entry.txSignature && (
                  <a
                    href={config.txExplorerUrl(entry.txSignature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-mono text-aperture-dark hover:text-black transition-colors"
                  >
                    tx
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                <span className="ml-auto text-[11px] tracking-tighter text-black/55">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Footer link to the on-chain Squads program */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-[12px] tracking-tighter text-black/55 pt-2">
        <span className="uppercase tracking-[0.08em] text-[11px]">Squads V4</span>
        <a
          href={config.explorerUrl(SQUADS_PROGRAM_ID)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-aperture-dark hover:text-black transition-colors"
        >
          {truncateAddress(SQUADS_PROGRAM_ID, 6)}
          <ExternalLink className="h-3 w-3" />
        </a>
        <span className="text-black/30">·</span>
        <a
          href="https://app.squads.so/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-aperture-dark hover:text-black transition-colors"
        >
          Open Squads app
        </a>
      </div>
    </div>
  );
}

interface WorkflowStep {
  readonly title: string;
  readonly body: string;
}

const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    title: 'Create in Squads',
    body: 'Open app.squads.so, build a multisig with your team, and choose a threshold. Squads stores all member metadata on-chain.',
  },
  {
    title: 'Look up & preview',
    body: 'Paste the multisig address here. policy-service reads Squads via RPC and shows you threshold, members, and the derived vault PDA.',
  },
  {
    title: 'Sign set_multisig',
    body: 'Your wallet sends one transaction calling set_multisig. The Policy Registry program persists the vault PDA on your OperatorAccount.',
  },
  {
    title: 'All policy ops governed',
    body: 'register_policy_multisig and update_policy_multisig now require the vault PDA as signer. Single-wallet shortcuts are rejected.',
  },
];

const ACTION_STYLE: Record<MultisigAuditEntry['action'], { background: string; color: string }> = {
  bind: { background: 'rgba(22,163,74,0.12)', color: '#16a34a' },
  sync: { background: 'rgba(8,145,178,0.12)', color: '#0891b2' },
  rotate: { background: 'rgba(248,179,0,0.15)', color: '#c98f00' },
  unbind: { background: 'rgba(220,38,38,0.12)', color: '#dc2626' },
};
