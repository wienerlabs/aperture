'use client';

/**
 * CompressionSavingsCard — replaces the legacy red/green/amber cost grid
 * with three Antimetal data cells + an aperture-tinted savings call-out.
 * Same numbers, computed by getProofRecordCostComparison() — purely visual.
 */

import { Sparkles } from 'lucide-react';
import {
  getProofRecordCostComparison,
  isLightProtocolConfigured,
  lamportsToSol,
} from '@/lib/light-protocol';
import { ProtocolBadge } from '@/components/shared/ProtocolBadge';

export function CompressionSavingsCard({ totalProofs }: { totalProofs: number }) {
  const cost = getProofRecordCostComparison();
  const regularTotal = cost.regularAccountRentLamports * totalProofs;
  const compressedTotal = cost.compressedTokenCostLamports * totalProofs;
  const savedTotal = regularTotal - compressedTotal;
  const active = isLightProtocolConfigured();

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Cell label="Regular PDA" value={`${lamportsToSol(regularTotal)} SOL`} subValue={`${lamportsToSol(cost.regularAccountRentLamports)} × ${totalProofs}`} />
        <Cell label="Compressed" value={`${lamportsToSol(compressedTotal)} SOL`} subValue={`${lamportsToSol(cost.compressedTokenCostLamports)} × ${totalProofs}`} />
        <Cell label="Saved" value={`${lamportsToSol(savedTotal)} SOL`} subValue={`${cost.savingsMultiplier}× cheaper · ${cost.savingsPercent}%`} accent />
      </div>

      <div className="flex items-center gap-2 text-[12px] tracking-tighter text-black/65 flex-wrap">
        <Sparkles className="h-3.5 w-3.5 text-aperture-dark" />
        <span
          className="inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium"
          style={{
            color: active ? '#16a34a' : '#7c8293',
            background: active ? 'rgba(22, 163, 74, 0.12)' : 'rgba(124, 130, 147, 0.10)',
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-pill"
            style={{ background: active ? '#16a34a' : '#7c8293' }}
          />
          {active ? 'active' : 'available'}
        </span>
        <ProtocolBadge protocol="light" showLabel />
        <span className="text-black/55">
          {active
            ? '— proof records can store as compressed tokens.'
            : '— configure NEXT_PUBLIC_LIGHT_RPC_URL to activate.'}
        </span>
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  subValue,
  accent,
}: {
  label: string;
  value: string;
  subValue?: string;
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
        className={`mt-0.5 font-mono text-[16px] font-semibold ${
          accent ? 'text-aperture-dark' : 'text-black'
        }`}
      >
        {value}
      </div>
      {subValue && (
        <div className="text-[11px] text-black/55 tracking-tighter mt-0.5">
          {subValue}
        </div>
      )}
    </div>
  );
}
