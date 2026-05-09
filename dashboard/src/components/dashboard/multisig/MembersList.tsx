'use client';

/**
 * MembersList — Squads V4 members with identicon, permission badges, and
 * stagger entrance. Permissions are a 3-bit mask (propose/vote/execute);
 * we decode client-side so the UI doesn't need a second RPC trip.
 */

import { motion } from 'framer-motion';
import { Vote, Send, Plus } from 'lucide-react';
import { truncateAddress } from '@/lib/utils';
import type { MultisigMember } from '@/lib/api';
import { CopyableField } from '../shared/CopyableField';
import { MemberAvatar } from './MemberAvatar';

interface MembersListProps {
  readonly members: readonly MultisigMember[];
  readonly currentWallet?: string | null;
}

interface PermissionFlag {
  readonly bit: number;
  readonly label: string;
  readonly icon: typeof Vote;
  readonly description: string;
  readonly tone: { background: string; color: string };
}

const PERMISSION_FLAGS: readonly PermissionFlag[] = [
  { bit: 1 << 0, label: 'Propose', icon: Plus, description: 'Can create transactions',
    tone: { background: 'rgba(22,163,74,0.10)', color: '#16a34a' } },
  { bit: 1 << 1, label: 'Vote', icon: Vote, description: 'Can approve / reject',
    tone: { background: 'rgba(8,145,178,0.10)', color: '#0891b2' } },
  { bit: 1 << 2, label: 'Execute', icon: Send, description: 'Can execute approved txs',
    tone: { background: 'rgba(248,179,0,0.15)', color: '#c98f00' } },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

export function MembersList({ members, currentWallet }: MembersListProps): JSX.Element {
  return (
    <motion.ul
      className="flex flex-col gap-2"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {members.map((member) => {
        const isYou = Boolean(currentWallet && member.key === currentWallet);
        const permissionLabels = PERMISSION_FLAGS.filter(
          (f) => (member.permissionsMask & f.bit) !== 0,
        );
        return (
          <motion.li
            key={member.key}
            variants={itemVariants}
            whileHover={{ y: -1 }}
            className={`flex flex-col gap-2 rounded-[14px] border px-3 py-2.5 transition-colors ${
              isYou
                ? 'border-aperture/45 bg-[rgba(248,179,0,0.06)]'
                : 'border-black/8 bg-white hover:border-aperture/30'
            }`}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <MemberAvatar
                  pubkey={member.key}
                  size={40}
                  highlight={isYou}
                  permissionsMask={member.permissionsMask}
                />
                <div className="flex flex-col min-w-0">
                  <span className="font-mono text-[12px] text-black truncate">
                    {truncateAddress(member.key, 8)}
                  </span>
                  {isYou && (
                    <span className="inline-flex w-fit items-center gap-1 rounded-pill bg-green-500/10 px-2 py-0.5 text-[10px] font-medium tracking-tighter text-green-700 mt-0.5">
                      Connected wallet
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {permissionLabels.length === 0 ? (
                  <span className="text-[11px] text-black/45 italic">No permissions</span>
                ) : (
                  permissionLabels.map((p) => {
                    const Icon = p.icon;
                    return (
                      <motion.span
                        key={p.label}
                        title={p.description}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.25, delay: 0.05 }}
                        className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] font-medium tracking-tighter"
                        style={p.tone}
                      >
                        <Icon className="h-2.5 w-2.5" />
                        {p.label}
                      </motion.span>
                    );
                  })
                )}
              </div>
            </div>
            <CopyableField label="Pubkey" value={member.key} className="-mt-1" />
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
