'use client';

import { Navbar } from '@/components/landing/Navbar';
import { ExternalLink, Shield, Zap, Lock, CheckCircle, ArrowRight, Search } from 'lucide-react';

function H2({ id, children }: { id: string; children: string }) {
  return <h2 id={id} className="text-2xl font-bold text-amber-100 mt-12 mb-4 scroll-mt-20">{children}</h2>;
}

function H3({ children }: { children: string }) {
  return <h3 className="text-lg font-semibold text-amber-100 mt-8 mb-3">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-amber-100/70 leading-relaxed mb-4">{children}</p>;
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-[#0d0a00] border border-amber-400/10 rounded-lg p-4 overflow-x-auto text-xs font-mono text-amber-200 leading-relaxed mb-4">
      {children.trim()}
    </pre>
  );
}

function Inline({ children }: { children: string }) {
  return <code className="px-1.5 py-0.5 bg-amber-400/10 text-amber-400 text-xs rounded font-mono">{children}</code>;
}

export default function AIPPage() {
  return (
    <div className="min-h-screen bg-[#090600] text-amber-100">
      <Navbar />

      <div className="max-w-4xl mx-auto px-6 py-24">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-medium mb-6">
            <Zap className="w-3.5 h-3.5" />
            Live on Solana Devnet
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-amber-100 mb-4">
            AIP Protocol Integration
          </h1>
          <p className="text-lg text-amber-100/70 max-w-2xl mx-auto">
            Aperture provides zero-knowledge compliance verification for AI agent payments
            on the Agent Internet Protocol. Every payment is proven compliant without
            revealing trade secrets.
          </p>
        </div>

        {/* What We Solved */}
        <H2 id="problem">The Problem We Solve</H2>
        <div className="bg-[rgba(20,14,0,0.8)] border border-red-400/20 rounded-xl p-6 mb-6">
          <P>
            When an enterprise deploys AI agents that make financial transactions, the legal
            department asks:
          </P>
          <blockquote className="border-l-2 border-red-400/40 pl-4 my-4 text-amber-100/80 text-sm italic">
            &ldquo;How do you prove every agent payment complied with our policies, didn&apos;t pay
            sanctioned addresses, and stayed within daily limits?&rdquo;
          </blockquote>
          <P>
            The only answer today: hand over all on-chain activity to an auditor. This leaks
            competitive intelligence — which APIs you use, how often, how much you spend, and
            who you pay.
          </P>
        </div>

        <div className="bg-[rgba(20,14,0,0.8)] border border-green-400/20 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-green-400" />
            <span className="text-sm font-semibold text-green-400">Aperture&apos;s Solution</span>
          </div>
          <P>
            Zero-knowledge proofs. Aperture generates a cryptographic proof that a payment
            is compliant — without revealing the amount, recipient, or any transaction details.
            Auditors verify the proof, not the data.
          </P>
        </div>

        {/* What We Built */}
        <H2 id="integration">What We Built</H2>
        <P>
          Aperture reads AIP&apos;s on-chain agent registry directly from Solana and provides a
          compliance layer for every agent payment.
        </P>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          {[
            {
              title: 'Agent Discovery',
              desc: 'AIP agents are read directly from Solana devnet registry. No API key needed — on-chain data is public.',
              Icon: Search,
            },
            {
              title: 'Policy Enforcement',
              desc: 'Operators define spending limits, blocked addresses, allowed categories. Every payment is checked before execution.',
              Icon: Shield,
            },
            {
              title: 'ZK Proof Generation',
              desc: 'RISC Zero generates a zero-knowledge proof that the payment complies with all policies. No details revealed.',
              Icon: Lock,
            },
            {
              title: 'On-Chain Verification',
              desc: 'Proof is verified on Solana via Aperture\'s Verifier program. Immutable audit trail with Solana Explorer links.',
              Icon: CheckCircle,
            },
          ].map((item) => (
            <div key={item.title} className="bg-[rgba(20,14,0,0.8)] border border-amber-400/20 rounded-xl p-5">
              <item.Icon className="w-5 h-5 text-amber-400 mb-2" />
              <h4 className="text-sm font-semibold text-amber-100 mb-1">{item.title}</h4>
              <p className="text-xs text-amber-100/70">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* How It Works */}
        <H2 id="how-it-works">How It Works</H2>
        <div className="space-y-4 mb-8">
          {[
            { step: 1, title: 'Operator Sets Policy', desc: 'Daily limit, per-transaction limit, blocked addresses, allowed categories, token whitelist.' },
            { step: 2, title: 'User Selects AIP Agent', desc: 'Browse agents from the AIP registry in the Aperture dashboard. See capabilities, pricing, and live status.' },
            { step: 3, title: 'Compliance Check', desc: 'Before payment, Aperture checks: Does this payment comply with the operator\'s policy? Amount within limits? Address not sanctioned?' },
            { step: 4, title: 'ZK Proof Generated', desc: 'RISC Zero produces a zero-knowledge proof: "This payment is compliant" — without revealing amount, recipient, or details.' },
            { step: 5, title: 'On-Chain Verification', desc: 'Proof is submitted to Aperture\'s Solana Verifier program. ComplianceStatus PDA is updated on-chain.' },
            { step: 6, title: 'Payment Executes', desc: 'Only after proof verification, the payment is sent to the AIP agent via JSON-RPC. Non-compliant payments are blocked.' },
            { step: 7, title: 'Audit Link Created', desc: 'A shareable audit page is generated. Anyone can verify compliance without seeing transaction details.' },
          ].map((item) => (
            <div key={item.step} className="flex gap-4 items-start">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400 text-sm font-bold">
                {item.step}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-100">{item.title}</h4>
                <p className="text-xs text-amber-100/70 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* What the Auditor Sees */}
        <H2 id="privacy">What an Auditor Sees vs. What&apos;s Hidden</H2>
        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <div className="bg-[rgba(20,14,0,0.8)] border border-green-400/20 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm font-semibold text-green-400">Auditor Can See</span>
            </div>
            <ul className="space-y-2 text-xs text-amber-100/70">
              <li>• Compliance verdict: compliant or not</li>
              <li>• Amount range (e.g. 0-1 USDC, not exact amount)</li>
              <li>• ZK proof hash (cryptographic fingerprint)</li>
              <li>• Solana transaction signature</li>
              <li>• Timestamp of verification</li>
              <li>• Policy violation count: 0</li>
              <li>• Sanctions intersection count: 0</li>
            </ul>
          </div>
          <div className="bg-[rgba(20,14,0,0.8)] border border-red-400/20 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-4 h-4 text-red-400" />
              <span className="text-sm font-semibold text-red-400">Hidden by ZK Proofs</span>
            </div>
            <ul className="space-y-2 text-xs text-amber-100/70">
              <li>• Exact payment amount</li>
              <li>• Recipient wallet address</li>
              <li>• Which agent was used</li>
              <li>• What task was requested</li>
              <li>• How often you use the service</li>
              <li>• Your spending patterns</li>
              <li>• Your vendor relationships</li>
            </ul>
          </div>
        </div>

        {/* Technical Details */}
        <H2 id="technical">Technical Details</H2>
        <H3>On-Chain Programs</H3>
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-amber-400/10">
                <th className="text-left py-2 text-amber-100/60 font-medium">Program</th>
                <th className="text-left py-2 text-amber-100/60 font-medium">Address</th>
                <th className="text-left py-2 text-amber-100/60 font-medium">Role</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              <tr className="border-b border-amber-400/5">
                <td className="py-2.5 text-amber-100">Aperture Policy Registry</td>
                <td className="py-2.5 font-mono text-amber-400">
                  <a href="https://explorer.solana.com/address/FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU?cluster=devnet" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    FXD7yc...4ZEU
                  </a>
                </td>
                <td className="py-2.5 text-amber-100/70">Store operator policies on-chain</td>
              </tr>
              <tr className="border-b border-amber-400/5">
                <td className="py-2.5 text-amber-100">Aperture Verifier</td>
                <td className="py-2.5 font-mono text-amber-400">
                  <a href="https://explorer.solana.com/address/AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU?cluster=devnet" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    AzKirE...fU
                  </a>
                </td>
                <td className="py-2.5 text-amber-100/70">Verify ZK proofs and update ComplianceStatus</td>
              </tr>
              <tr className="border-b border-amber-400/5">
                <td className="py-2.5 text-amber-100">Aperture Transfer Hook</td>
                <td className="py-2.5 font-mono text-amber-400">
                  <a href="https://explorer.solana.com/address/3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt?cluster=devnet" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    3GZAsA...CQt
                  </a>
                </td>
                <td className="py-2.5 text-amber-100/70">Block non-compliant vUSDC transfers</td>
              </tr>
              <tr>
                <td className="py-2.5 text-amber-100">AIP Agent Registry</td>
                <td className="py-2.5 font-mono text-amber-400">
                  <a href="https://explorer.solana.com/address/CgchXu2dRV3r9E1YjRhp4kbeLLtv1Xz61yoerJzp1Vbc?cluster=devnet" target="_blank" rel="noopener noreferrer" className="hover:underline">
                    CgchXu...Vbc
                  </a>
                </td>
                <td className="py-2.5 text-amber-100/70">AIP&apos;s agent discovery registry (read-only)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <H3>ZK Proof Stack</H3>
        <P>
          Proofs are generated using <strong className="text-amber-400">RISC Zero zkVM</strong>, a general-purpose
          zero-knowledge virtual machine. The prover runs a Rust guest program inside the zkVM that checks
          all policy rules and outputs a cryptographic receipt.
        </P>
        <Code>{`
// Simplified proof flow
ProverInput {
  policy: { daily_limit, per_tx_limit, blocked_addresses, ... },
  payment: { amount, recipient, token, category },
  daily_spent_so_far
}
    ↓ RISC Zero zkVM
ProverOutput {
  is_compliant: true,
  proof_hash: "d7d2a028f689...",
  amount_range: { min: 0, max: 1_000_000 },  // bucketed, not exact
  journal_digest: "sha256(...)"
}
        `}</Code>

        {/* How to Test */}
        <H2 id="test">How to Test</H2>
        <div className="space-y-6 mb-8">
          {[
            {
              step: 1,
              title: 'Connect Wallet',
              desc: 'Connect a Phantom or Solflare wallet set to Solana Devnet.',
            },
            {
              step: 2,
              title: 'Create a Policy',
              desc: 'Go to Dashboard → Policies → Create Policy. Set a daily limit (e.g. 100 USDC), per-transaction limit (e.g. 10 USDC), add "x402" and "mpp" to allowed categories, and add the USDC devnet mint to token whitelist.',
            },
            {
              step: 3,
              title: 'Open AIP Agents Tab',
              desc: 'Go to Dashboard → AIP Agents. You\'ll see agents registered on AIP\'s Solana devnet registry.',
            },
            {
              step: 4,
              title: 'Select an Agent & Capability',
              desc: 'Click on an agent to expand it. Select a capability (e.g. "defi.analyze" on Terminator).',
            },
            {
              step: 5,
              title: 'Execute with Compliance',
              desc: 'Enter a task input and click "Execute with Compliance". Watch the pipeline: policy check → ZK proof generation → Solana verification → audit link.',
            },
            {
              step: 6,
              title: 'Verify the Proof',
              desc: 'Click "View Audit Page" to see the public compliance record. Click "Verify on Solana" to see the on-chain transaction.',
            },
          ].map((item) => (
            <div key={item.step} className="flex gap-4 items-start">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400 text-sm font-bold">
                {item.step}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-amber-100">{item.title}</h4>
                <p className="text-xs text-amber-100/70 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Architecture */}
        <H2 id="architecture">Architecture</H2>
        <Code>{`
┌──────────────────────────────────────────────────────────┐
│                    Aperture Dashboard                     │
│   AIP Agents Tab → Select Agent → Enter Task → Execute   │
└────────────────────────┬─────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │   Policy    │ │   Prover    │ │ Compliance  │
  │   Service   │ │   Service   │ │    API      │
  │  (Express)  │ │ (RISC Zero) │ │  (Express)  │
  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
         │               │               │
         ▼               ▼               ▼
  ┌────────────────────────────────────────────┐
  │              Solana Devnet                  │
  │  Policy Registry │ Verifier │ Transfer Hook│
  └────────────────────────────────────────────┘
         │
         ▼
  ┌─────────────────────┐
  │   AIP Registry      │ ← getProgramAccounts (read-only)
  │   (on-chain agents) │
  └─────────────────────┘
        `}</Code>

        {/* Current Status */}
        <H2 id="status">Current Status</H2>
        <div className="space-y-3 mb-8">
          {[
            { label: 'Agent discovery from AIP registry', done: true },
            { label: 'Policy-based compliance check before payment', done: true },
            { label: 'RISC Zero ZK proof generation', done: true },
            { label: 'On-chain proof verification (Solana)', done: true },
            { label: 'Audit page with shareable link', done: true },
            { label: 'AIP task history with proof records', done: true },
            { label: 'AIP DID ↔ Aperture operator binding', done: true },
            { label: 'Agent task response (requires AIP auth)', done: false },
            { label: 'Escrow-gated payment release (CPI)', done: false },
            { label: 'Multi-agent pipeline compliance', done: false },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              {item.done ? (
                <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border border-amber-400/30 flex-shrink-0" />
              )}
              <span className={`text-sm ${item.done ? 'text-amber-100' : 'text-amber-100/50'}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="bg-[rgba(20,14,0,0.8)] border border-amber-400/20 rounded-xl p-8 text-center mt-12">
          <h3 className="text-xl font-bold text-amber-100 mb-2">Try It Now</h3>
          <p className="text-sm text-amber-100/70 mb-6">
            Connect your wallet, create a policy, and verify your first AIP agent payment with zero-knowledge proofs.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition-colors"
            >
              Open Dashboard
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="/docs"
              className="inline-flex items-center gap-2 px-6 py-3 border border-amber-400/20 text-amber-400 font-medium rounded-lg hover:bg-amber-400/10 transition-colors"
            >
              Read Docs
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-amber-100/40 text-xs mt-12">
          Aperture Protocol — Zero-knowledge compliance for the agent economy. Built on Solana.
        </p>
      </div>
    </div>
  );
}
