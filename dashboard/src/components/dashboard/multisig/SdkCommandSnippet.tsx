'use client';

/**
 * SdkCommandSnippet — terminal-style multi-line command card with a
 * click-to-copy affordance. Used in MultisigBindingCard / MultisigTab to
 * replace the old Squads UI deep links: Aperture's SDK CLI
 * (scripts/squads-cli.ts + scripts/squads-devnet-bind.ts) drives the
 * full multisig flow from the operator's terminal, so the dashboard
 * just hands the operator the exact command and lets them paste it.
 */

import { useState } from 'react';
import { Copy, Check, TerminalSquare } from 'lucide-react';
import { motion } from 'framer-motion';

interface SdkCommandSnippetProps {
  readonly title: string;
  readonly description?: string;
  readonly command: string;
  readonly note?: string;
}

export function SdkCommandSnippet({
  title,
  description,
  command,
  note,
}: SdkCommandSnippetProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className="rounded-[14px] border border-black/12 bg-white overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-black/8 bg-[rgba(248,179,0,0.05)]">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalSquare className="h-3.5 w-3.5 shrink-0 text-aperture-dark" />
          <span className="text-[12px] font-medium tracking-tighter text-black truncate">
            {title}
          </span>
        </div>
        <motion.button
          type="button"
          onClick={handleCopy}
          whileTap={{ scale: 0.96 }}
          className="shrink-0 inline-flex items-center gap-1 rounded-pill border border-black/8 bg-white px-2 py-0.5 text-[11px] font-medium tracking-tighter text-black/65 hover:text-black hover:border-aperture/40 transition-colors"
          aria-label="Copy command"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-green-600" />
              <span className="text-green-700">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </>
          )}
        </motion.button>
      </div>
      {description && (
        <p className="px-3 pt-2 text-[12px] text-black/65 tracking-tighter">
          {description}
        </p>
      )}
      <pre className="px-3 py-2.5 overflow-x-auto text-[12px] leading-relaxed font-mono text-black whitespace-pre">
{command.split('\n').map((line, i) => (
  <div key={i} className="flex gap-2">
    <span className="select-none text-black/35">$</span>
    <span className="break-all">{line}</span>
  </div>
))}
      </pre>
      {note && (
        <p className="px-3 pb-2 text-[11px] text-black/45 tracking-tighter">
          {note}
        </p>
      )}
    </div>
  );
}
