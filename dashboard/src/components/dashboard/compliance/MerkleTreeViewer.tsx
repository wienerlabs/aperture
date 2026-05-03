'use client';

/**
 * MerkleTreeViewer — pure-SVG visual of the policy Merkle tree referenced in
 * the README. Renders root → 2 inner nodes → 4 leaves and labels each leaf
 * with the rule type. Each node short-hashes the byte string so the layout
 * stays readable at any width. Click-to-copy on every node.
 */

import { useState, useMemo } from 'react';
import { Copy, Check, GitBranch } from 'lucide-react';
import { truncateAddress } from '@/lib/utils';

interface MerkleTreeViewerProps {
  /** Root hex hash of the Merkle tree — typically batch_proof_hash. */
  readonly rootHash: string;
  /** Optional; one entry per ruleset leaf. Up to 4 are rendered. */
  readonly leaves?: readonly { label: string; hash: string }[];
}

const DEFAULT_LEAVES = [
  { label: 'max_daily_spend', hash: 'leaf-1' },
  { label: 'max_per_tx', hash: 'leaf-2' },
  { label: 'allowed_categories', hash: 'leaf-3' },
  { label: 'blocked_addresses', hash: 'leaf-4' },
];

export function MerkleTreeViewer({ rootHash, leaves }: MerkleTreeViewerProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const data = useMemo(() => {
    const final = (leaves && leaves.length > 0 ? leaves : DEFAULT_LEAVES).slice(0, 4);
    while (final.length < 4) final.push({ label: '—', hash: '0x00…' });
    return final;
  }, [leaves]);

  // Synthetic inner-node short hashes (purely visual; on-chain the inner
  // commitments are derived from real leaf hashes via Poseidon. We don't
  // reproduce that here because we don't have the witness on the client).
  const innerLeft = synthetic(data[0].hash, data[1].hash);
  const innerRight = synthetic(data[2].hash, data[3].hash);

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="ap-card p-5 sm:p-6 flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-[18px] tracking-[-0.005em] text-black flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-aperture-dark" />
            Policy Merkle Tree
          </h3>
          <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
            Each rule is a leaf; the tree root is what gets anchored on-chain.
          </p>
        </div>
        <button
          type="button"
          onClick={() => copy(rootHash, 'root')}
          className="inline-flex items-center gap-1.5 rounded-pill bg-aperture/12 px-2.5 py-1 text-[11px] font-medium tracking-tighter text-aperture-dark hover:bg-aperture/20 transition-colors"
        >
          {copied === 'root' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied === 'root' ? 'Copied' : 'Copy root'}
        </button>
      </header>

      {/* Tree layout */}
      <div className="relative flex flex-col items-center gap-3 py-2">
        {/* Root */}
        <Node
          variant="root"
          label="root"
          hash={rootHash}
          onCopy={() => copy(rootHash, 'root-node')}
          copied={copied === 'root-node'}
        />

        {/* Connector lines */}
        <Connector />

        {/* Inner nodes */}
        <div className="grid grid-cols-2 gap-6 w-full">
          <Node
            variant="inner"
            label="inner-L"
            hash={innerLeft}
            onCopy={() => copy(innerLeft, 'inner-L')}
            copied={copied === 'inner-L'}
          />
          <Node
            variant="inner"
            label="inner-R"
            hash={innerRight}
            onCopy={() => copy(innerRight, 'inner-R')}
            copied={copied === 'inner-R'}
          />
        </div>

        {/* Connector lines */}
        <Connector spread />

        {/* Leaves */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full">
          {data.map((leaf, i) => (
            <Node
              key={`${leaf.label}-${i}`}
              variant="leaf"
              label={leaf.label}
              hash={leaf.hash}
              onCopy={() => copy(leaf.hash, `leaf-${i}`)}
              copied={copied === `leaf-${i}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Node({
  variant,
  label,
  hash,
  onCopy,
  copied,
}: {
  variant: 'root' | 'inner' | 'leaf';
  label: string;
  hash: string;
  onCopy: () => void;
  copied: boolean;
}) {
  const ring = variant === 'root' ? 'border-aperture/45' : 'border-black/12';
  const tint = variant === 'root' ? 'bg-aperture/6' : 'bg-white';
  const labelTone =
    variant === 'leaf' ? 'text-black/55 uppercase tracking-[0.06em]' : 'text-aperture-dark';

  return (
    <button
      type="button"
      onClick={onCopy}
      className={`group relative flex flex-col items-start gap-1 rounded-[14px] border ${ring} ${tint} px-3 py-2 hover:border-aperture/45 hover:shadow-[0_4px_12px_-6px_rgba(101,69,0,0.18)] transition-all`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] font-medium tracking-tighter ${labelTone}`}>
          {label}
        </span>
        <span className="text-black/30">
          {copied ? (
            <Check className="h-2.5 w-2.5 text-green-600" />
          ) : (
            <Copy className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </span>
      </div>
      <span className="text-[11px] font-mono text-black tracking-tighter">
        {truncateAddress(hash, 6)}
      </span>
    </button>
  );
}

function Connector({ spread = false }: { spread?: boolean }) {
  return (
    <svg
      width="100%"
      height={20}
      viewBox="0 0 200 20"
      preserveAspectRatio="none"
      className="text-black/15"
      aria-hidden
    >
      {spread ? (
        <>
          <line x1="50" y1="0" x2="20" y2="20" stroke="currentColor" strokeWidth="1" />
          <line x1="50" y1="0" x2="80" y2="20" stroke="currentColor" strokeWidth="1" />
          <line x1="150" y1="0" x2="120" y2="20" stroke="currentColor" strokeWidth="1" />
          <line x1="150" y1="0" x2="180" y2="20" stroke="currentColor" strokeWidth="1" />
        </>
      ) : (
        <>
          <line x1="100" y1="0" x2="50" y2="20" stroke="currentColor" strokeWidth="1" />
          <line x1="100" y1="0" x2="150" y2="20" stroke="currentColor" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}

function synthetic(a: string, b: string): string {
  // Tiny stable string hash so the inner-node label always renders the
  // same characters for the same children. Not cryptographic.
  let h = 5381;
  const both = `${a}|${b}`;
  for (let i = 0; i < both.length; i++) h = (h * 33) ^ both.charCodeAt(i);
  const hex = (h >>> 0).toString(16).padStart(8, '0');
  return `0x${hex}${hex}`;
}
