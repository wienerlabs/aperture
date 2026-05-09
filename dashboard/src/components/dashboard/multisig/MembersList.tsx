'use client';

/**
 * MembersList — renders Squads V4 multisig members with their permission
 * badges. The Squads SDK exposes permissions as a 3-bit bitmask:
 *   bit 0 = propose
 *   bit 1 = vote
 *   bit 2 = execute
 * We decode the mask client-side so the dashboard can label each member
 * without a second RPC trip.
 */

import { Crown, Vote, Send, Plus } from 'lucide-react';
import { truncateAddress } from '@/lib/utils';
import type { MultisigMember } from '@/lib/api';
import { CopyableField } from '../shared/CopyableField';

interface MembersListProps {
  readonly members: readonly MultisigMember[];
  readonly currentWallet?: string | null;
}

interface PermissionFlag {
  readonly bit: number;
  readonly label: string;
  readonly icon: typeof Vote;
  readonly description: string;
}

const PERMISSION_FLAGS: readonly PermissionFlag[] = [
  { bit: 1 << 0, label: 'Propose', icon: Plus, description: 'Can create transactions' },
  { bit: 1 << 1, label: 'Vote', icon: Vote, description: 'Can approve / reject' },
  { bit: 1 << 2, label: 'Execute', icon: Send, description: 'Can execute approved transactions' },
];

export function MembersList({ members, currentWallet }: MembersListProps) {
  return (
    <div className="flex flex-col gap-2">
      {members.map((member) => {
        const isYou = currentWallet && member.key === currentWallet;
        const permissionLabels = PERMISSION_FLAGS.filter(
          (f) => (member.permissionsMask & f.bit) !== 0,
        );

        return (
          <div
            key={member.key}
            className={`flex flex-col gap-2 rounded-[14px] border px-3 py-2.5 ${
              isYou
                ? 'border-aperture/45 bg-[rgba(248,179,0,0.06)]'
                : 'border-black/8 bg-white'
            }`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
                  <Crown className="h-3.5 w-3.5" />
                </span>
                <span className="font-mono text-[12px] text-black truncate">
                  {truncateAddress(member.key, 8)}
                </span>
                {isYou && (
                  <span className="inline-flex items-center rounded-pill bg-green-500/10 px-2 py-0.5 text-[10px] font-medium tracking-tighter text-green-700">
                    You
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {permissionLabels.length === 0 ? (
                  <span className="text-[11px] text-black/45 italic">
                    No permissions
                  </span>
                ) : (
                  permissionLabels.map((p) => {
                    const Icon = p.icon;
                    return (
                      <span
                        key={p.label}
                        title={p.description}
                        className="inline-flex items-center gap-1 rounded-pill bg-black/5 px-2 py-0.5 text-[10px] font-medium tracking-tighter text-black/70"
                      >
                        <Icon className="h-2.5 w-2.5" />
                        {p.label}
                      </span>
                    );
                  })
                )}
              </div>
            </div>
            <CopyableField
              label="Pubkey"
              value={member.key}
              className="-mt-1"
            />
          </div>
        );
      })}
    </div>
  );
}
