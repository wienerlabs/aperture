'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface Tab {
  readonly id: string;
  readonly label: string;
  readonly language: string;
  readonly source: string;
  readonly sourcePath: string | null;
}

interface CodeTabsProps {
  readonly tabs: readonly Tab[];
}

export function CodeTabs({ tabs }: CodeTabsProps) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? '');
  const [copied, setCopied] = useState(false);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]!;

  function handleCopy() {
    navigator.clipboard.writeText(active.source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  }

  return (
    <div className="rounded-lg border border-amber-400/10 overflow-hidden">
      <div className="flex items-center justify-between border-b border-amber-400/10 bg-[#0d0a00]">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className={`font-mono text-xs px-4 py-2.5 transition-colors ${
                tab.id === active.id
                  ? 'text-amber-400 bg-amber-400/5 border-b-2 border-amber-400'
                  : 'text-amber-400/70 hover:text-amber-400/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-400/75 hover:text-amber-400 transition-colors mr-3"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="bg-[#0d0a00] text-xs font-mono text-amber-200 leading-relaxed p-4 overflow-x-auto whitespace-pre max-h-[32rem]">
        {active.source}
      </pre>
      {active.sourcePath && (
        <div className="bg-[#0d0a00] border-t border-amber-400/5 px-4 py-2 font-mono text-[10px] text-amber-400/60">
          Source: {active.sourcePath}
        </div>
      )}
    </div>
  );
}
