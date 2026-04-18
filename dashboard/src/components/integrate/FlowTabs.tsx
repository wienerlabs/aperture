'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export interface FlowStep {
  readonly title: string;
  readonly description: string;
  readonly code?: {
    readonly source: string;
    readonly sourcePath: string | null;
    readonly language: string;
  };
}

export interface FlowTroubleshoot {
  readonly issue: string;
  readonly fix: string;
}

export interface Flow {
  readonly id: string;
  readonly label: string;
  readonly tagline: string;
  readonly prerequisites: readonly string[];
  readonly steps: readonly FlowStep[];
  readonly verification: {
    readonly description: string;
    readonly command: string;
  };
  readonly troubleshooting: readonly FlowTroubleshoot[];
}

interface FlowTabsProps {
  readonly flows: readonly Flow[];
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
      className="inline-flex items-center gap-1 text-[11px] font-mono text-amber-400/75 hover:text-amber-400 transition-colors"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ source, sourcePath }: { source: string; sourcePath: string | null }) {
  return (
    <div className="rounded-lg border border-amber-400/10 overflow-hidden">
      <div className="flex items-center justify-between bg-[#0a0a0a] px-3 py-2 border-b border-amber-400/10">
        <span className="font-mono text-[10px] text-amber-400/60 truncate">{sourcePath ?? 'inline'}</span>
        <CopyButton text={source} />
      </div>
      <pre className="bg-[#0a0a0a] text-xs font-mono text-amber-200 leading-relaxed p-4 overflow-x-auto whitespace-pre max-h-[28rem]">
        {source}
      </pre>
    </div>
  );
}

export function FlowTabs({ flows }: FlowTabsProps) {
  const [activeId, setActiveId] = useState<string>(flows[0]?.id ?? '');
  const active = flows.find((f) => f.id === activeId) ?? flows[0]!;

  return (
    <div>
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 mb-8 border-b border-amber-400/10 pb-4">
        {flows.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setActiveId(f.id)}
            className={`font-mono text-xs px-3 py-2 rounded transition-colors ${
              f.id === active.id
                ? 'bg-amber-400/10 text-amber-400 border border-amber-400/30'
                : 'text-amber-400/75 hover:text-amber-400 border border-transparent hover:border-amber-400/20'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Active flow content */}
      <div>
        <div className="mb-8">
          <h2 className="font-mono text-2xl font-bold text-amber-100 mb-2">{active.label}</h2>
          <p className="text-sm text-amber-400/75 leading-relaxed">{active.tagline}</p>
        </div>

        <Section title="Prerequisites">
          <ul className="space-y-1.5">
            {active.prerequisites.map((item) => (
              <li key={item} className="font-mono text-xs text-amber-200/80 flex gap-2">
                <span className="text-amber-400/60 flex-shrink-0">—</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Steps">
          <div className="space-y-6">
            {active.steps.map((step, idx) => (
              <div key={`${idx}-${step.title}`}>
                <p className="font-mono text-[11px] text-amber-400/60 mb-1">{String(idx + 1).padStart(2, '0')}</p>
                <h3 className="font-mono text-sm font-semibold text-amber-100 mb-2">{step.title}</h3>
                <p className="text-sm text-amber-400/75 mb-3 leading-relaxed">{step.description}</p>
                {step.code && (
                  <CodeBlock source={step.code.source} sourcePath={step.code.sourcePath} />
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Verification">
          <p className="text-sm text-amber-400/75 mb-3 leading-relaxed">{active.verification.description}</p>
          <CodeBlock source={active.verification.command} sourcePath="verification command" />
        </Section>

        <Section title="Troubleshooting">
          <div className="space-y-4">
            {active.troubleshooting.map((entry) => (
              <div key={entry.issue} className="rounded-lg border border-amber-400/10 p-4">
                <p className="font-mono text-sm text-amber-200 mb-1.5">{entry.issue}</p>
                <p className="text-xs text-amber-400/75 leading-relaxed">{entry.fix}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-10">
      <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-amber-400/70 mb-4">{title}</h3>
      {children}
    </div>
  );
}
