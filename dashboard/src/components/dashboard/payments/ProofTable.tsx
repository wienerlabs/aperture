'use client';

/**
 * ProofTable — Antimetal-styled replacement for the legacy dark-theme proofs
 * grid. Same data, same expandable hash UX, but rendered as a white surface
 * with hairline rows and subtle hover, plus pill-shaped status badges and an
 * ExternalLink icon for the Solana tx — keeping the Payments tab visually
 * consistent with Overview / Policies.
 */

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { config as apertureConfig } from '@/lib/config';
import { truncateAddress, formatAmount, formatDate } from '@/lib/utils';
import type { ProofRecord } from '@/lib/api';

const TOKEN_LABEL: Record<string, string> = {};

function getTokenLabel(mint: string): string {
  const t = apertureConfig.tokens;
  if (TOKEN_LABEL[mint]) return TOKEN_LABEL[mint];
  if (t.aUSDC && mint === t.aUSDC) return 'aUSDC';
  if (t.usdc && mint === t.usdc) return 'USDC';
  if (t.usdt && mint === t.usdt) return 'USDT';
  return truncateAddress(mint, 4);
}

export function ProofTable({ proofs }: { proofs: readonly ProofRecord[] }) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyToClipboard(text: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard API may be unavailable */
    }
  }

  return (
    <div className="ap-card overflow-hidden">
      <header className="px-5 py-4 flex items-center justify-between border-b border-black/8">
        <div>
          <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
            Verified Proof Ledger
          </h3>
          <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
            Every row is anchored on Solana with a public signature.
          </p>
        </div>
        <span className="inline-flex items-center rounded-pill bg-aperture/12 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark">
          {proofs.length.toLocaleString()} record{proofs.length === 1 ? '' : 's'}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-[rgba(248,179,0,0.04)]">
              {['Payment', 'Policy', 'Proof Hash', 'Amount', 'Token', 'Status', 'Verified', 'Tx'].map(
                (label) => (
                  <th
                    key={label}
                    className="text-left px-5 py-3 text-[11px] font-medium uppercase tracking-[0.08em] text-black/55"
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/8">
            {proofs.map((proof) => (
              <tr key={proof.id} className="hover:bg-[rgba(248,179,0,0.04)] transition-colors">
                <td className="px-5 py-3 text-[12px] font-mono text-black">
                  {truncateAddress(proof.payment_id, 6)}
                </td>
                <td className="px-5 py-3 text-[12px] font-mono text-black/65">
                  {truncateAddress(proof.policy_id, 6)}
                </td>
                <td className="px-5 py-3 text-[12px]">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        setExpandedHash(expandedHash === proof.id ? null : proof.id)
                      }
                      className="font-mono text-aperture-dark hover:text-black transition-colors"
                      title="Click to expand"
                    >
                      {expandedHash === proof.id
                        ? proof.proof_hash
                        : truncateAddress(proof.proof_hash, 8)}
                    </button>
                    <button
                      onClick={() => copyToClipboard(proof.proof_hash, proof.id)}
                      className="text-black/45 hover:text-black transition-colors"
                      aria-label="Copy proof hash"
                    >
                      {copiedId === proof.id ? (
                        <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </td>
                <td className="px-5 py-3 text-[12px] font-mono text-black">
                  {formatAmount(proof.amount_range_min)} – {formatAmount(proof.amount_range_max)}
                </td>
                <td className="px-5 py-3 text-[12px]">
                  <span className="inline-flex items-center rounded-pill bg-aperture/12 px-2 py-0.5 text-[11px] font-mono text-aperture-dark">
                    {getTokenLabel(proof.token_mint)}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {proof.is_compliant ? (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-green-500/10 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-green-700">
                      <CheckCircle className="h-3 w-3" />
                      Compliant
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-pill bg-red-500/12 px-2 py-0.5 text-[11px] font-medium tracking-tighter text-red-700">
                      <XCircle className="h-3 w-3" />
                      Rejected
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-[12px] text-black/65 tracking-tighter">
                  {formatDate(proof.verified_at)}
                </td>
                <td className="px-5 py-3 text-[12px]">
                  {proof.tx_signature ? (
                    <a
                      href={apertureConfig.txExplorerUrl(proof.tx_signature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-aperture-dark hover:text-black font-mono transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View
                    </a>
                  ) : (
                    <span className="text-black/35">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
