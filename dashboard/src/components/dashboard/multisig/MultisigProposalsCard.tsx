'use client';

/**
 * MultisigProposalsCard — pending and recently-executed Squads proposals
 * for an operator. Squads owns the canonical state on chain; this card
 * mirrors the off-chain index that policy-service maintains so the
 * dashboard can render approval counts + jump-to-Squads buttons without
 * round-tripping every paint.
 *
 * Heavy use of framer-motion: filter pills slide, rows stagger in,
 * status pills cross-fade between phases.
 */

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ExternalLink,
  Hourglass,
  CheckCircle2,
  XCircle,
  Send,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { config } from '@/lib/config';
import { truncateAddress } from '@/lib/utils';
import type {
  MultisigBinding,
  MultisigProposal,
  MultisigProposalStatus,
} from '@/lib/api';

interface MultisigProposalsCardProps {
  readonly proposals: readonly MultisigProposal[];
  readonly binding: MultisigBinding | null;
  readonly loading: boolean;
  readonly statusFilter: MultisigProposalStatus | 'all';
  readonly onChangeFilter: (status: MultisigProposalStatus | 'all') => void;
  readonly onRefresh?: () => void;
}

const FILTER_OPTIONS: ReadonlyArray<{
  id: MultisigProposalStatus | 'all';
  label: string;
}> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'executed', label: 'Executed' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

const ACTION_LABEL: Record<MultisigProposal['action'], string> = {
  register_policy: 'Register policy',
  update_policy: 'Update policy',
  deactivate_policy: 'Deactivate policy',
  rotate_multisig: 'Rotate multisig',
  custom: 'Custom action',
};

const STATUS_TONE: Record<
  MultisigProposalStatus,
  { background: string; color: string; icon: typeof Hourglass }
> = {
  pending: { background: 'rgba(248,179,0,0.16)', color: '#c98f00', icon: Hourglass },
  approved: { background: 'rgba(8,145,178,0.12)', color: '#0891b2', icon: CheckCircle2 },
  executed: { background: 'rgba(22,163,74,0.12)', color: '#16a34a', icon: CheckCircle2 },
  rejected: { background: 'rgba(220,38,38,0.12)', color: '#dc2626', icon: XCircle },
  cancelled: { background: 'rgba(124,130,147,0.12)', color: '#596075', icon: XCircle },
  expired: { background: 'rgba(124,130,147,0.12)', color: '#596075', icon: XCircle },
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const rowVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export function MultisigProposalsCard({
  proposals,
  binding,
  loading,
  statusFilter,
  onChangeFilter,
}: MultisigProposalsCardProps): JSX.Element {
  const filtered = useMemo(() => {
    if (statusFilter === 'all') return proposals;
    return proposals.filter((p) => p.status === statusFilter);
  }, [proposals, statusFilter]);

  return (
    <section className="ap-card overflow-hidden">
      <header className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap border-b border-black/8">
        <div className="flex items-center gap-2.5">
          <Send className="h-4 w-4 text-aperture-dark" />
          <h2 className="font-display text-[18px] tracking-[-0.005em] text-black">
            Multisig Proposals
          </h2>
          <span className="inline-flex items-center rounded-pill bg-aperture/12 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-aperture-dark">
            {filtered.length} of {proposals.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTER_OPTIONS.map((option) => {
            const isActive = statusFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChangeFilter(option.id)}
                className="relative inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-medium tracking-tighter transition-colors"
                style={{
                  color: isActive ? '#c98f00' : '#596075',
                  background: isActive ? 'rgba(248,179,0,0.12)' : 'rgba(0,0,0,0.04)',
                }}
              >
                {isActive && (
                  <motion.span
                    layoutId="proposal-filter-active"
                    className="absolute inset-0 rounded-pill border border-aperture/45"
                    style={{ pointerEvents: 'none' }}
                    transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                  />
                )}
                <span className="relative">{option.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-aperture-dark" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center px-6">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
            <Sparkles className="h-5 w-5" />
          </span>
          <p className="text-[13px] tracking-tighter text-black">
            {statusFilter === 'all'
              ? 'No proposals yet'
              : `No ${statusFilter} proposals`}
          </p>
          <p className="text-[12px] text-black/55 tracking-tighter max-w-md">
            {binding
              ? 'Once you register or update a policy via the Multisig flow, the proposal lands here. Squads holds the canonical state on chain.'
              : 'Bind a Squads multisig first — until then policy operations sign with your wallet directly.'}
          </p>
        </div>
      ) : (
        <motion.ol
          className="divide-y divide-black/8"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence initial={false}>
            {filtered.map((proposal) => {
              const tone = STATUS_TONE[proposal.status];
              const Icon = tone.icon;
              return (
                <motion.li
                  key={proposal.id}
                  variants={rowVariants}
                  initial="hidden"
                  animate="visible"
                  exit={{ opacity: 0, y: -6 }}
                  className="px-5 py-3 flex flex-col gap-2 hover:bg-[rgba(248,179,0,0.04)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <motion.span
                        layout
                        className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.04em]"
                        style={tone}
                      >
                        <Icon className="h-2.5 w-2.5" />
                        {proposal.status}
                      </motion.span>
                      <span className="text-[13px] tracking-tighter text-black truncate">
                        {ACTION_LABEL[proposal.action]}
                      </span>
                      {proposal.policyId && (
                        <span className="font-mono text-[11px] text-black/55">
                          policy {truncateAddress(proposal.policyId, 4)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {proposal.executedTx && (
                        <a
                          href={config.txExplorerUrl(proposal.executedTx)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-aperture-dark hover:text-black"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Tx
                        </a>
                      )}
                      {proposal.transactionPda && proposal.multisigAddress && (
                        <a
                          href={config.proposalViewerUrl(
                            proposal.multisigAddress,
                            proposal.transactionIndex,
                            proposal.proposalPda ?? undefined,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-pill border border-black/8 bg-white px-2 py-0.5 text-[11px] font-medium tracking-tighter text-aperture-dark hover:border-aperture/40 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {config.multisigViewerIsExplorer ? 'Explorer' : 'Squads'}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-[11px] tracking-tighter text-black/55">
                    <span className="font-mono">
                      {truncateAddress(proposal.transactionPda, 6)}
                    </span>
                    <span>
                      {proposal.approvalCount} approval
                      {proposal.approvalCount === 1 ? '' : 's'}
                    </span>
                    {proposal.rejectionCount > 0 && (
                      <span className="text-red-700/85">
                        {proposal.rejectionCount} reject
                        {proposal.rejectionCount === 1 ? '' : 's'}
                      </span>
                    )}
                    <span>by {truncateAddress(proposal.createdBy, 4)}</span>
                    <span className="ml-auto">
                      {new Date(proposal.createdAt).toLocaleString()}
                    </span>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ol>
      )}
    </section>
  );
}
