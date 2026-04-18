import Link from 'next/link';
import { ArrowRight, ExternalLink, KeyRound } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { CodeTabs } from '@/components/developers/CodeTabs';
import { ApiKeysManager } from '@/components/developers/ApiKeysManager';
import { readSample } from '@/lib/code-samples';

export const dynamic = 'force-dynamic';

interface ProgramEntry {
  readonly label: string;
  readonly envKey: string;
  readonly id: string | null;
  readonly description: string;
}

function programs(): readonly ProgramEntry[] {
  return [
    {
      label: 'Policy Registry',
      envKey: 'NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM',
      id: process.env.NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM ?? null,
      description: 'Anchor program storing on-chain policies and Squads multisig bindings.',
    },
    {
      label: 'ZK Verifier',
      envKey: 'NEXT_PUBLIC_VERIFIER_PROGRAM',
      id: process.env.NEXT_PUBLIC_VERIFIER_PROGRAM ?? null,
      description: 'Verifies RISC Zero journals, records ComplianceStatus PDAs and batch attestations.',
    },
    {
      label: 'Transfer Hook',
      envKey: 'NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM',
      id: process.env.NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM ?? null,
      description: 'SPL Token-2022 transfer hook enforcing ComplianceStatus on vUSDC transfers.',
    },
  ];
}

function proverServiceUrlForExamples(): string {
  return process.env.NEXT_PUBLIC_PROVER_SERVICE_URL ?? 'http://localhost:3003';
}

function agentServiceUrlForExamples(): string {
  return process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ?? 'http://localhost:3004';
}

function policyServiceUrlForExamples(): string {
  return process.env.NEXT_PUBLIC_POLICY_SERVICE_URL ?? 'http://localhost:3001';
}

function githubUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_GITHUB_URL ?? process.env.GITHUB_REPO_URL;
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function DevelopersPage() {
  const typescriptSample = readSample('sdk/agent/src/prover-client.ts');
  const rustSample = readSample('services/prover-service/src/prover.rs');
  const agentSample = readSample('services/agent-service/src/agent-loop.ts');

  const proverUrl = proverServiceUrlForExamples();
  const agentUrl = agentServiceUrlForExamples();
  const policyUrl = policyServiceUrlForExamples();

  const proveCurl = `curl -X POST "${proverUrl}/prove" \\
  -H "Content-Type: application/json" \\
  -d '{
    "policy_id": "<uuid>",
    "operator_id": "<base58-wallet>",
    "max_daily_spend_lamports": 10000000,
    "max_per_transaction_lamports": 5000000,
    "allowed_endpoint_categories": ["x402", "mpp"],
    "blocked_addresses": [],
    "token_whitelist": ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"],
    "payment_amount_lamports": 1000000,
    "payment_token_mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    "payment_recipient": "<recipient-wallet>",
    "payment_endpoint_category": "x402",
    "payment_timestamp": "2026-04-16T00:00:00Z",
    "daily_spent_so_far_lamports": 0
  }'`;

  const startAgentCurl = `curl -X POST "${agentUrl}/start"`;

  const createPolicyCurl = `curl -X POST "${policyUrl}/api/v1/policies" \\
  -H "Content-Type: application/json" \\
  -d '{
    "operator_id": "<operator-uuid>",
    "name": "x402 default",
    "max_daily_spend": 10,
    "max_per_transaction": 5,
    "allowed_endpoint_categories": ["x402", "mpp"],
    "blocked_addresses": [],
    "time_restrictions": [],
    "token_whitelist": ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"]
  }'`;

  const gh = githubUrl();

  return (
    <main className="relative min-h-screen bg-[#000000] flex flex-col">
      <Navbar />

      <section className="relative z-10 pt-28 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="font-mono text-4xl sm:text-5xl font-bold text-amber-400 mb-4">Build with Aperture</h1>
          <p className="text-amber-400/75 text-base max-w-2xl mx-auto leading-relaxed">
            ZK-proof compliance for AI agent payments on Solana. Generate real RISC Zero proofs, enforce policies on-chain, settle via x402 or MPP.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/integrate"
              className="inline-flex items-center gap-2 font-mono text-sm px-5 py-2.5 bg-amber-400 text-black rounded-lg font-semibold hover:bg-amber-300 transition-colors"
            >
              Quick Start <ArrowRight size={16} />
            </Link>
            <Link
              href="/api-docs"
              className="inline-flex items-center gap-2 font-mono text-sm px-5 py-2.5 border border-amber-400/30 text-amber-400 rounded-lg hover:bg-amber-400/10 transition-colors"
            >
              API Reference <ExternalLink size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <KeyRound className="w-5 h-5 text-amber-400" />
            <h2 className="font-mono text-2xl font-bold text-amber-400">API Keys</h2>
          </div>
          <p className="text-sm text-amber-400/75 mb-6 max-w-2xl">
            Authenticate programmatic access by sending the <code className="font-mono text-amber-300">X-API-Key</code> header. Keys are bound to your account and revocable at any time. The plain-text key is revealed exactly once at creation.
          </p>
          <ApiKeysManager />
        </div>
      </section>

      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-12 border-t border-amber-400/10">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-mono text-2xl font-bold text-amber-400 mb-8">Quick Start</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <QuickStartCard
              number="01"
              title="Generate your first ZK proof"
              description="POST a policy + payment context to the prover-service to produce a ~255 KB RISC Zero STARK receipt."
              command={proveCurl}
            />
            <QuickStartCard
              number="02"
              title="Register a policy on-chain"
              description="Create a policy via the Policy Service REST API. The policy-registry program stores a merkle root on-chain."
              command={createPolicyCurl}
            />
            <QuickStartCard
              number="03"
              title="Run the autonomous agent"
              description="Start the agent loop. It will validate policy categories, health-check the prover, and begin cycling."
              command={startAgentCurl}
            />
          </div>
        </div>
      </section>

      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-12 border-t border-amber-400/10">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-mono text-2xl font-bold text-amber-400 mb-3">Code samples</h2>
          <p className="text-sm text-amber-400/75 mb-6">
            Real source code from this repository — not hand-edited snippets. Paths are shown below each tab.
          </p>
          <CodeTabs
            tabs={[
              {
                id: 'ts-prover',
                label: 'TypeScript · Prover client',
                language: 'typescript',
                source: typescriptSample.source,
                sourcePath: typescriptSample.path,
              },
              {
                id: 'rust-prover',
                label: 'Rust · zkVM prover',
                language: 'rust',
                source: rustSample.source,
                sourcePath: rustSample.path,
              },
              {
                id: 'ts-agent',
                label: 'TypeScript · Agent loop',
                language: 'typescript',
                source: agentSample.source,
                sourcePath: agentSample.path,
              },
            ]}
          />
        </div>
      </section>

      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-12 border-t border-amber-400/10">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-mono text-2xl font-bold text-amber-400 mb-6">Programs on Solana Devnet</h2>
          <div className="rounded-lg border border-amber-400/10 overflow-hidden">
            {programs().map((p, idx) => (
              <div
                key={p.envKey}
                className={`px-5 py-4 ${idx > 0 ? 'border-t border-amber-400/10' : ''}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm text-amber-100">{p.label}</p>
                    <p className="font-mono text-[10px] text-amber-400/60 mt-1">{p.envKey}</p>
                  </div>
                  {p.id ? (
                    <a
                      href={`https://explorer.solana.com/address/${p.id}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-xs text-amber-400 hover:text-amber-300 transition-colors break-all"
                    >
                      {p.id}
                      <ExternalLink size={12} className="flex-shrink-0" />
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-amber-400/60">Not configured</span>
                  )}
                </div>
                <p className="text-xs text-amber-400/70 mt-2">{p.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 px-4 sm:px-6 lg:px-8 py-12 border-t border-amber-400/10">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-mono text-2xl font-bold text-amber-400 mb-6">Resources</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              href="/docs"
              className="rounded-lg border border-amber-400/10 px-5 py-4 hover:bg-amber-400/5 transition-colors block"
            >
              <p className="font-mono text-sm text-amber-200">Docs</p>
              <p className="text-xs text-amber-400/70 mt-1">Architecture, SDK reference, FAQ.</p>
            </Link>
            <Link
              href="/changelog"
              className="rounded-lg border border-amber-400/10 px-5 py-4 hover:bg-amber-400/5 transition-colors block"
            >
              <p className="font-mono text-sm text-amber-200">Changelog</p>
              <p className="text-xs text-amber-400/70 mt-1">Release notes and version history.</p>
            </Link>
            {gh ? (
              <a
                href={gh}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-amber-400/10 px-5 py-4 hover:bg-amber-400/5 transition-colors flex items-center justify-between"
              >
                <div>
                  <p className="font-mono text-sm text-amber-200 inline-flex items-center gap-2">
                    <ExternalLink size={14} /> GitHub
                  </p>
                  <p className="text-xs text-amber-400/70 mt-1">Source code and issue tracker.</p>
                </div>
                <ExternalLink size={14} className="text-amber-400/60" />
              </a>
            ) : (
              <Link
                href="/integrate"
                className="rounded-lg border border-amber-400/10 px-5 py-4 hover:bg-amber-400/5 transition-colors block"
              >
                <p className="font-mono text-sm text-amber-200">Integrate</p>
                <p className="text-xs text-amber-400/70 mt-1">Step-by-step integration flows.</p>
              </Link>
            )}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function QuickStartCard({ number, title, description, command }: { number: string; title: string; description: string; command: string }) {
  return (
    <div className="rounded-lg border border-amber-400/10 p-5 flex flex-col">
      <p className="font-mono text-[11px] text-amber-400/60 mb-2">{number}</p>
      <h3 className="font-mono text-sm font-semibold text-amber-100 mb-2">{title}</h3>
      <p className="text-xs text-amber-400/75 mb-4 flex-1">{description}</p>
      <pre className="bg-[#0a0a0a] border border-amber-400/10 rounded p-3 text-[11px] font-mono text-amber-200 overflow-x-auto whitespace-pre leading-relaxed max-h-48">
        {command}
      </pre>
    </div>
  );
}
