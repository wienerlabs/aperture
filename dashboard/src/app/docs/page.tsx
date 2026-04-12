'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ApertureLogo } from '@/components/shared/ApertureLogo';
import { ThemeToggle } from '@/components/shared/ThemeToggle';

const SECTIONS = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'introduction', label: 'Introduction' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'sdk-reference', label: 'SDK Reference' },
  { id: 'x402-integration', label: 'x402 Integration' },
  { id: 'mpp-integration', label: 'MPP Integration' },
  { id: 'autonomous-agent', label: 'Autonomous Agent' },
  { id: 'agent-service', label: 'Agent Service' },
  { id: 'policy-engine', label: 'Policy Engine' },
  { id: 'zk-proofs', label: 'ZK Proofs' },
  { id: 'api-reference', label: 'API Reference' },
  { id: 'faq', label: 'FAQ' },
] as const;

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-[#0d0a00] border border-amber-400/10 rounded-lg p-4 overflow-x-auto text-xs font-mono text-amber-200 leading-relaxed">
      {children.trim()}
    </pre>
  );
}

function H2({ id, children }: { id: string; children: string }) {
  return <h2 id={id} className="text-2xl font-bold text-amber-100 mt-12 mb-4 scroll-mt-20">{children}</h2>;
}

function H3({ children }: { children: string }) {
  return <h3 className="text-lg font-semibold text-amber-100 mt-8 mb-3">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-amber-100/60 leading-relaxed mb-4">{children}</p>;
}

function Inline({ children }: { children: string }) {
  return <code className="px-1.5 py-0.5 bg-amber-400/10 text-amber-400 text-xs rounded font-mono">{children}</code>;
}

export default function DocsPage() {
  const [active, setActive] = useState('introduction');

  useEffect(() => {
    function handleScroll() {
      const ids = SECTIONS.map(s => s.id);
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 120) current = id;
        }
      }
      setActive(current);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#090600] text-amber-100">
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-[rgba(9,6,0,0.95)] backdrop-blur border-b border-amber-400/10">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-80"><ApertureLogo /></Link>
            <span className="text-amber-100/30 text-sm">/</span>
            <span className="text-amber-100/80 text-sm font-medium">Documentation</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">Dashboard</Link>
            <ThemeToggle />
            <Link href="/" className="text-xs text-amber-100/40 hover:text-amber-100 transition-colors">Home</Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">
        {/* Sidebar */}
        <aside className="hidden lg:block w-56 shrink-0 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-6 border-r border-amber-400/10">
          <nav className="space-y-1">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  active === s.id
                    ? 'bg-amber-400/10 text-amber-400 font-medium'
                    : 'text-amber-100/40 hover:text-amber-100/70'
                }`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 px-8 py-8 max-w-3xl">

          {/* Getting Started */}
          <H2 id="getting-started">Getting Started</H2>
          <P>Step-by-step guide to using the Aperture compliance platform. Follow these steps in order to experience the full workflow.</P>

          <div className="space-y-6 mb-8">
            {[
              {
                step: 1,
                title: 'Connect Wallet',
                items: [
                  <>Connect your <strong className="text-amber-400">Phantom</strong> or <strong className="text-amber-400">Solflare</strong> wallet</>,
                  <>Click the wallet button in the top-right corner</>,
                  <>Make sure your wallet is set to <strong className="text-amber-400">Devnet</strong></>,
                ],
              },
              {
                step: 2,
                title: 'Create a Policy',
                items: [
                  <>Navigate to the <strong className="text-amber-400">Policies</strong> tab</>,
                  <>Click <strong className="text-amber-400">Create Policy</strong></>,
                  <>Configure: max daily spend, max per transaction, allowed categories, token whitelist</>,
                  <>Sign the transaction -- policy is registered on <strong className="text-amber-400">Solana Devnet</strong></>,
                ],
              },
              {
                step: 3,
                title: 'Simulate a Payment',
                items: [
                  <>Go to the <strong className="text-amber-400">Payments</strong> tab</>,
                  <>Click <strong className="text-amber-400">Simulate Payment</strong></>,
                  <>A real <strong className="text-amber-400">RISC Zero ZK proof</strong> is generated (may take a few seconds on warm cache)</>,
                  <>Sign the transaction -- proof is verified on Solana with an explorer link</>,
                ],
              },
              {
                step: 4,
                title: 'Test Transfer Hook',
                items: [
                  <>In Payments tab, expand the <strong className="text-amber-400">Transfer Hook Test</strong> panel</>,
                  <><strong className="text-amber-400">Transfer Without Proof</strong> -- rejected if wallet has no ComplianceStatus PDA</>,
                  <><strong className="text-amber-400">Transfer With Proof</strong> -- succeeds after ZK proof verification</>,
                ],
              },
              {
                step: 5,
                title: 'Access Protected Report (x402)',
                items: [
                  <>In Payments tab, click <strong className="text-amber-400">Access Protected Report</strong></>,
                  <>1 USDC is paid via Solana, ZK proof is generated</>,
                  <>Compliance report is returned with on-chain verification</>,
                ],
              },
              {
                step: 6,
                title: 'Access MPP Report',
                items: [
                  <>In Payments tab, click <strong className="text-amber-400">Access MPP Report</strong></>,
                  <>$0.50 is paid via <strong className="text-amber-400">Stripe</strong>, ZK proof is generated</>,
                  <>Proof is verified on Solana -- dual settlement (Stripe + Solana)</>,
                ],
              },
              {
                step: 7,
                title: 'Create Batch Attestation',
                items: [
                  <>Go to the <strong className="text-amber-400">Compliance</strong> tab</>,
                  <>Click <strong className="text-amber-400">Create Batch Attestation</strong>, select a time period</>,
                  <>Sign the transaction -- attestation is anchored on Solana</>,
                  <>Use <strong className="text-amber-400">Share Audit Link</strong> to send to auditors</>,
                ],
              },
              {
                step: 8,
                title: 'Run the Agent',
                items: [
                  <>Go to the <strong className="text-amber-400">Agent Activity</strong> tab</>,
                  <>Click <strong className="text-amber-400">Start Agent</strong> -- runs autonomously every 30 seconds</>,
                  <>Watches: policy check, ZK proof, x402 payment, MPP payment, batch attestation</>,
                  <>Click <strong className="text-amber-400">Stop Agent</strong> to halt the loop</>,
                ],
              },
              {
                step: 9,
                title: 'View Audit Page',
                items: [
                  <>In Compliance tab, click <strong className="text-amber-400">Share Audit Link</strong> on any attestation</>,
                  <>Auditors see: <strong className="text-amber-400">COMPLIANT</strong> badge, proof hash, payment count</>,
                  <><strong className="text-amber-400">Verify on Solana</strong> button links directly to the on-chain transaction</>,
                ],
              },
            ].map(({ step, title, items }) => (
              <div key={step} className="bg-[rgba(20,14,0,0.8)] border border-amber-400/10 rounded-lg p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-6 h-6 rounded-full bg-amber-400/10 text-amber-400 text-xs font-bold flex items-center justify-center">{step}</span>
                  <span className="text-sm font-semibold text-amber-100">{title}</span>
                </div>
                <ul className="space-y-1.5 ml-12">
                  {items.map((item, i) => (
                    <li key={i} className="text-xs text-amber-100/50 leading-relaxed flex items-start gap-2">
                      <span className="text-amber-400/40 mt-0.5">-</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Introduction */}
          <H2 id="introduction">Introduction</H2>
          <P>
            Aperture is a zero-knowledge compliance and privacy layer for AI agent payments on Solana.
            It enables AI agents to prove they comply with operator-defined policies -- spending limits,
            sanctions checks, allowed categories, time-based rules -- without revealing any payment details.
          </P>
          <P>
            As AI agents begin making autonomous payments (API calls, compute resources, data purchases),
            enterprises need compliance guarantees without sacrificing privacy or speed.
            Traditional compliance requires exposing transaction details to auditors.
            Aperture proves compliance cryptographically: <strong className="text-amber-400">Prove compliance. Reveal nothing.</strong>
          </P>

          {/* How It Works */}
          <H2 id="how-it-works">How It Works</H2>
          <P>Aperture operates in four steps:</P>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            {[
              { step: '1', title: 'Policy', desc: 'Operator defines compliance rules: spending limits, token whitelist, blocked addresses, time restrictions. Policy is registered on-chain via the Policy Registry program.' },
              { step: '2', title: 'Proof', desc: 'When a payment occurs, the RISC Zero zkVM generates a cryptographic proof that the payment complies with the policy -- without revealing payment details.' },
              { step: '3', title: 'Pay', desc: 'The payment is executed via x402 or MPP protocol. The ZK proof is attached to the payment header, enabling the recipient to verify compliance.' },
              { step: '4', title: 'Verify', desc: 'The proof is verified on-chain via the Verifier program. A ComplianceStatus PDA is created, enabling the SPL Token-2022 transfer hook to enforce compliance.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="bg-[rgba(20,14,0,0.8)] border border-amber-400/10 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-6 h-6 rounded-full bg-amber-400/10 text-amber-400 text-xs font-bold flex items-center justify-center">{step}</span>
                  <span className="text-sm font-semibold text-amber-100">{title}</span>
                </div>
                <p className="text-xs text-amber-100/50 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>

          {/* Architecture */}
          <H2 id="architecture">Architecture</H2>
          <P>Aperture consists of four layers:</P>
          <div className="space-y-3 mb-6">
            {[
              { name: 'Policy Registry', desc: 'Anchor program on Solana. Stores operator accounts and policy PDAs with merkle roots and data hashes.', id: 'CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs' },
              { name: 'ZK Payment Prover', desc: 'RISC Zero zkVM circuit. Executes 5 compliance checks inside the zkVM and produces a 255KB cryptographic receipt.', id: 'services/prover-service (port 3003)' },
              { name: 'Compliance Aggregator', desc: 'Backend service that aggregates proof records into batch attestations with SHA-256 batch hashes.', id: 'services/compliance-api (port 3002)' },
              { name: 'On-chain Verifier', desc: 'Anchor program that verifies receipt integrity (SHA-256 check) and creates ProofRecord + ComplianceStatus PDAs.', id: 'HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr' },
            ].map(({ name, desc, id }) => (
              <div key={name} className="bg-[rgba(20,14,0,0.8)] border border-amber-400/10 rounded-lg p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-amber-100">{name}</span>
                  <span className="text-xs font-mono text-amber-400/40">{id.length > 20 ? id.slice(0, 8) + '...' : id}</span>
                </div>
                <p className="text-xs text-amber-100/50">{desc}</p>
              </div>
            ))}
          </div>
          <H3>Tech Stack</H3>
          <P>RISC Zero zkVM, Solana (Anchor + pure SDK), SPL Token-2022 Transfer Hook, Light Protocol ZK Compression, Squads V4 Multisig, x402 (Coinbase), MPP (Stripe/Tempo).</P>

          {/* SDK Reference */}
          <H2 id="sdk-reference">SDK Reference</H2>
          <H3>x402 Adapter</H3>
          <Code>{`import { fetchWithX402 } from '@/lib/x402-client';

const result = await fetchWithX402(
  'http://localhost:3002/api/v1/compliance/protected-report?operator_id=...',
  connection,    // Solana Connection
  publicKey,     // Wallet PublicKey
  sendTransaction // from useWallet()
);

// result.payment.txSignature -- Solana transaction
// result.payment.zkProofHash -- ZK proof hash
// result.data -- Compliance report`}</Code>

          <H3>Prover Client (Rust)</H3>
          <Code>{`use aperture_prover::ProverClient;

let client = ProverClient::new(ProverServiceConfig {
    endpoint: "http://localhost:3003".into(),
    timeout_secs: 600,
})?;

let input = client.build_prover_input(&policy, &payment, daily_spent)?;
let request = client.build_proof_request(&input)?;
let result = client.generate_proof(&request).await?;
// result.proof_hash, result.receipt_bytes, result.image_id`}</Code>

          <H3>MPP Client</H3>
          <Code>{`import { fetchWithMPP } from '@/lib/mpp-client';

const result = await fetchWithMPP(
  'http://localhost:3002/api/v1/compliance/mpp-report?operator_id=...',
  'pk_test_...' // Stripe publishable key
);

// result.payment.paymentIntentId -- Stripe PaymentIntent
// result.payment.zkProofHash -- ZK proof hash
// result.payment.solanaTxSignature -- Solana TX
// result.data -- Compliance report`}</Code>

          <H3>Agent SDK</H3>
          <Code>{`// sdk/agent/src/agent.ts -- runs all 4 steps autonomously
import { PolicyChecker } from './policy-checker';
import { ProverClient } from './prover-client';
import { X402Payer } from './x402-payer';
import { MPPPayer } from './mpp-payer';

// 1. PolicyChecker: loads and enforces operator policy
const checker = new PolicyChecker('http://localhost:3001');
await checker.loadPolicy(operatorId);
const result = checker.checkPayment({ amountLamports, tokenMint, recipient, endpointCategory });

// 2. ProverClient: generates RISC Zero ZK proof
const prover = new ProverClient('http://localhost:3003');
const proof = await prover.generateProof(compiled, amount, mint, recipient, category, dailySpent);

// 3. X402Payer: pays via USDC on Solana with Keypair signing
const x402 = new X402Payer(rpcUrl, wallet, 'http://localhost:3002');
const x402Result = await x402.payForReport(operatorId, proof.proof_hash);

// 4. MPPPayer: pays via Stripe PaymentIntent (server-side)
const mpp = new MPPPayer('http://localhost:3002', stripeSecretKey);
const mppResult = await mpp.payForReport(operatorId);`}</Code>

          <H3>Anchor Instruction Builder</H3>
          <Code>{`import { buildVerifyPaymentProofIx, deriveOperatorPDA } from '@/lib/anchor-instructions';

const ix = buildVerifyPaymentProofIx(
  operator,           // PublicKey
  payer,              // PublicKey
  policyPDA,          // PublicKey
  proofHashBytes,     // Uint8Array[32]
  imageId,            // number[8]
  journalDigestBytes, // Uint8Array[32]
  receiptBytes        // Uint8Array
);`}</Code>

          {/* x402 Integration */}
          <H2 id="x402-integration">x402 Integration</H2>
          <P>
            x402 is the Coinbase HTTP 402 payment protocol for machine-to-machine payments.
            Aperture extends x402 by attaching ZK compliance proofs to payment headers.
          </P>
          <H3>Flow</H3>
          <P>
            1. Client sends GET request to a protected endpoint.
            2. Server returns <Inline>402 Payment Required</Inline> with payment requirements (token, amount, recipient).
            3. Client generates a ZK proof via the prover service.
            4. Client signs a USDC transfer transaction with the connected wallet.
            5. Client retries with <Inline>x-402-payment</Inline> header containing the tx signature and ZK proof hash.
            6. Server verifies the transaction on-chain and returns the protected resource.
          </P>
          <Code>{`// x-402-payment header format (base64-encoded JSON)
{
  "txSignature": "5DY5P9WXPm...",
  "payer": "CBDjvUkZZ6uc...",
  "zkProofHash": "37b708db1af0..."
}`}</Code>

          {/* MPP Integration */}
          <H2 id="mpp-integration">MPP Integration</H2>
          <P>
            MPP (Machine Payments Protocol) uses Stripe PaymentIntents with an HTTP 402 challenge/credential/receipt flow.
            Designed for AI agent-to-service payments with ZK compliance proofs recorded on both Stripe and Solana.
          </P>
          <H3>Flow</H3>
          <P>
            1. Client sends GET request to <Inline>/api/v1/compliance/mpp-report</Inline>.
            2. Server creates a Stripe PaymentIntent and returns <Inline>402</Inline> with an HMAC-bound challenge.
            3. Client confirms payment via Stripe.js (test mode: <Inline>pm_card_visa</Inline>).
            4. Client retries with <Inline>x-mpp-credential</Inline> header containing the challenge ID and PaymentIntent ID.
            5. Server verifies payment status via Stripe API and returns the compliance report with a <Inline>Payment-Receipt</Inline> header.
          </P>
          <H3>Dual Settlement</H3>
          <P>
            Each MPP payment creates records in both Stripe (PaymentIntent with MPP metadata) and
            Solana Devnet (ZK proof verified on-chain via the Verifier program).
          </P>
          <Code>{`// x-mpp-credential header format (base64-encoded JSON)
{
  "challengeId": "47d5016c73b015e7...",
  "paymentIntentId": "pi_3TJsfqFIw4F8j032..."
}`}</Code>

          {/* Autonomous Agent */}
          <H2 id="autonomous-agent">Autonomous Agent</H2>
          <P>
            Aperture includes a fully autonomous AI agent SDK that enforces compliance policies,
            generates ZK proofs, makes payments via both x402 and MPP, and anchors attestations on Solana --
            all without human intervention. The agent uses a server-side Keypair for Solana transactions
            (no wallet popup required).
          </P>
          <H3>Agent Lifecycle</H3>
          <P>
            1. Load active policy from the Policy Service and compile for ZK circuit.
            2. For each payment: check policy rules (limits, categories, blocked addresses, token whitelist).
            3. Generate RISC Zero ZK proof of compliance.
            4. Execute payment via x402 (USDC on Solana) or MPP (Stripe PaymentIntent).
            5. Submit proof record to Compliance API.
            6. Create batch attestation and anchor on Solana via <Inline>verify_batch_attestation</Inline>.
          </P>
          <H3>Running the Agent SDK</H3>
          <Code>{`# Configure agent wallet
cd sdk/agent
cp .env.example .env
# Set AGENT_WALLET_PRIVATE_KEY (base58 or JSON array)

# Run single session
npx tsx src/agent.ts`}</Code>
          <H3>Agent Output</H3>
          <Code>{`[Aperture Agent] Policy loaded: max_daily=50 USDC, max_per_tx=5 USDC
[Aperture Agent] Policy check passed. Generating ZK proof...
[Aperture Agent] ZK proof generated in 5.7s (249KB receipt)
[Aperture Agent] Paying via x402: 1 USDC
[Aperture Agent] Payment verified on-chain: https://explorer.solana.com/tx/...
[Aperture Agent] Paying via MPP: $0.50
[Aperture Agent] MPP payment verified: pi_...
[Aperture Agent] Batch attestation anchored on Solana
[Aperture Agent] Session complete. Policy violations: 0`}</Code>

          {/* Agent Service */}
          <H2 id="agent-service">Agent Service</H2>
          <P>
            The Agent Service (<Inline>services/agent-service/</Inline>, port 3004) is an HTTP-controllable daemon
            that runs the agent in a continuous loop. Start and stop the agent remotely via the dashboard or API calls.
          </P>
          <H3>API</H3>
          <div className="space-y-2 mb-6">
            {[
              { m: 'POST', p: '/start', d: 'Start the agent loop (30s interval)' },
              { m: 'POST', p: '/stop', d: 'Stop the agent loop' },
              { m: 'GET', p: '/status', d: 'Running state, operator ID, stats' },
              { m: 'GET', p: '/activity', d: 'Live activity feed (last 200 records)' },
              { m: 'GET', p: '/health', d: 'Service health check' },
            ].map(({ m, p, d }) => (
              <div key={p} className="flex items-center gap-3 text-xs">
                <span className={`px-2 py-0.5 rounded font-mono font-bold ${m === 'GET' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400'}`}>{m}</span>
                <span className="font-mono text-amber-100/70">{p}</span>
                <span className="text-amber-100/30">{d}</span>
              </div>
            ))}
          </div>
          <H3>Dashboard Integration</H3>
          <P>
            The Agent Activity tab in the dashboard provides real-time monitoring with Start/Stop controls,
            a live activity feed (5s auto-refresh), and stats for sessions, x402 payments, MPP payments,
            ZK proofs, and policy violations. Every on-chain transaction has a Solana explorer link.
          </P>

          {/* Policy Engine */}
          <H2 id="policy-engine">Policy Engine</H2>
          <P>The RISC Zero guest program performs 5 compliance checks inside the zkVM:</P>
          <div className="space-y-2 mb-4">
            {[
              'Per-transaction limit: payment amount <= max_per_transaction',
              'Daily spending limit: daily_spent + amount <= max_daily_spend',
              'Token whitelist: payment token must be in allowed list',
              'Blocked addresses: recipient must not be on sanctions list',
              'Endpoint category: payment category must be in allowed list',
            ].map((check, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-100/50">
                <span className="text-amber-400 font-mono mt-0.5">{i + 1}.</span>
                <span>{check}</span>
              </div>
            ))}
          </div>
          <H3>Policy JSON Example</H3>
          <Code>{`{
  "operator_id": "CBDjvUkZZ6uc...",
  "name": "Standard Compliance",
  "max_daily_spend": 10000,
  "max_per_transaction": 5000,
  "allowed_endpoint_categories": ["compute", "storage", "api"],
  "blocked_addresses": [],
  "token_whitelist": ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"],
  "time_restrictions": [{
    "allowed_days": ["monday","tuesday","wednesday","thursday","friday"],
    "allowed_hours_start": 0,
    "allowed_hours_end": 23,
    "timezone": "UTC"
  }]
}`}</Code>

          {/* ZK Proofs */}
          <H2 id="zk-proofs">ZK Proofs</H2>
          <H3>RISC Zero zkVM</H3>
          <P>
            Aperture uses the RISC Zero zkVM to generate zero-knowledge proofs. The guest program
            (<Inline>circuits/payment-prover/</Inline>) runs inside the zkVM and produces a
            cryptographic receipt proving the computation was executed correctly.
          </P>
          <H3>Production vs Dev Mode</H3>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-amber-400/10">
                <th className="text-left py-2 text-amber-100/40">Metric</th>
                <th className="text-left py-2 text-amber-100/40">Dev Mode</th>
                <th className="text-left py-2 text-amber-100/40">Production</th>
              </tr></thead>
              <tbody className="text-amber-100/60">
                <tr className="border-b border-amber-400/5"><td className="py-2">Proving time</td><td>~130ms</td><td>~5 min (CPU), ~6s cached</td></tr>
                <tr className="border-b border-amber-400/5"><td className="py-2">Receipt size</td><td>569 bytes</td><td>255 KB</td></tr>
                <tr className="border-b border-amber-400/5"><td className="py-2">Cryptographic validity</td><td>Not valid</td><td>Fully valid</td></tr>
                <tr><td className="py-2">Use case</td><td>Development/testing</td><td>Production deployment</td></tr>
              </tbody>
            </table>
          </div>
          <H3>Light Protocol ZK Compression</H3>
          <P>
            Proof records can be stored as compressed tokens via Light Protocol,
            reducing on-chain storage costs by 146x. Each compressed token represents
            one compliance attestation. Cost: ~0.000010 SOL vs ~0.001462 SOL for a regular PDA.
          </P>

          {/* API Reference */}
          <H2 id="api-reference">API Reference</H2>

          <H3>Policy Service (port 3001)</H3>
          <div className="space-y-2 mb-6">
            {[
              { m: 'POST', p: '/api/v1/policies', d: 'Create policy' },
              { m: 'GET', p: '/api/v1/policies/operator/:operatorId', d: 'List policies' },
              { m: 'GET', p: '/api/v1/policies/:id', d: 'Get policy' },
              { m: 'PUT', p: '/api/v1/policies/:id', d: 'Update policy' },
              { m: 'DELETE', p: '/api/v1/policies/:id', d: 'Delete policy' },
              { m: 'GET', p: '/api/v1/policies/:id/compile', d: 'Compile for circuit' },
            ].map(({ m, p, d }) => (
              <div key={p} className="flex items-center gap-3 text-xs">
                <span className={`px-2 py-0.5 rounded font-mono font-bold ${m === 'GET' ? 'bg-green-400/10 text-green-400' : m === 'POST' ? 'bg-amber-400/10 text-amber-400' : m === 'PUT' ? 'bg-blue-400/10 text-blue-400' : 'bg-red-400/10 text-red-400'}`}>{m}</span>
                <span className="font-mono text-amber-100/70">{p}</span>
                <span className="text-amber-100/30">{d}</span>
              </div>
            ))}
          </div>

          <H3>Compliance API (port 3002)</H3>
          <div className="space-y-2 mb-6">
            {[
              { m: 'POST', p: '/api/v1/proofs', d: 'Submit proof record' },
              { m: 'GET', p: '/api/v1/proofs/operator/:operatorId', d: 'List proofs' },
              { m: 'PATCH', p: '/api/v1/proofs/:id/tx-signature', d: 'Store tx signature' },
              { m: 'POST', p: '/api/v1/attestations/batch', d: 'Create batch attestation' },
              { m: 'GET', p: '/api/v1/attestations/operator/:operatorId', d: 'List attestations' },
              { m: 'PATCH', p: '/api/v1/attestations/:id/tx-signature', d: 'Store tx signature' },
              { m: 'GET', p: '/api/v1/compliance/protected-report', d: 'x402 protected report (1 USDC)' },
              { m: 'GET', p: '/api/v1/compliance/mpp-report', d: 'MPP protected report ($0.50)' },
            ].map(({ m, p, d }) => (
              <div key={p+m} className="flex items-center gap-3 text-xs">
                <span className={`px-2 py-0.5 rounded font-mono font-bold ${m === 'GET' ? 'bg-green-400/10 text-green-400' : m === 'POST' ? 'bg-amber-400/10 text-amber-400' : 'bg-blue-400/10 text-blue-400'}`}>{m}</span>
                <span className="font-mono text-amber-100/70">{p}</span>
                <span className="text-amber-100/30">{d}</span>
              </div>
            ))}
          </div>

          <H3>Prover Service (port 3003)</H3>
          <div className="space-y-2 mb-6">
            {[
              { m: 'GET', p: '/health', d: 'Health check' },
              { m: 'POST', p: '/prove', d: 'Generate ZK proof (RISC Zero zkVM)' },
            ].map(({ m, p, d }) => (
              <div key={p} className="flex items-center gap-3 text-xs">
                <span className={`px-2 py-0.5 rounded font-mono font-bold ${m === 'GET' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400'}`}>{m}</span>
                <span className="font-mono text-amber-100/70">{p}</span>
                <span className="text-amber-100/30">{d}</span>
              </div>
            ))}
          </div>
          <H3>Agent Service (port 3004)</H3>
          <div className="space-y-2 mb-6">
            {[
              { m: 'POST', p: '/start', d: 'Start agent loop' },
              { m: 'POST', p: '/stop', d: 'Stop agent loop' },
              { m: 'GET', p: '/status', d: 'Agent status and stats' },
              { m: 'GET', p: '/activity', d: 'Live activity feed' },
              { m: 'GET', p: '/health', d: 'Health check' },
            ].map(({ m, p, d }) => (
              <div key={p} className="flex items-center gap-3 text-xs">
                <span className={`px-2 py-0.5 rounded font-mono font-bold ${m === 'GET' ? 'bg-green-400/10 text-green-400' : 'bg-amber-400/10 text-amber-400'}`}>{m}</span>
                <span className="font-mono text-amber-100/70">{p}</span>
                <span className="text-amber-100/30">{d}</span>
              </div>
            ))}
          </div>

          <Code>{`// POST /prove request body
{
  "policy_id": "...",
  "operator_id": "...",
  "max_daily_spend_lamports": 100000000,
  "max_per_transaction_lamports": 10000000,
  "allowed_endpoint_categories": ["compute"],
  "blocked_addresses": [],
  "token_whitelist": ["4zMMC9srt5Ri..."],
  "payment_amount_lamports": 5000000,
  "payment_token_mint": "4zMMC9srt5Ri...",
  "payment_recipient": "...",
  "payment_endpoint_category": "compute",
  "payment_timestamp": "2026-04-07T12:00:00Z",
  "daily_spent_so_far_lamports": 0
}

// Response
{
  "is_compliant": true,
  "proof_hash": "37b708db1af0...",
  "proving_time_ms": 5930,
  "receipt_bytes": [/* 255KB */],
  "image_id": [191609676, ...]
}`}</Code>

          {/* FAQ */}
          <H2 id="faq">FAQ</H2>
          <div className="space-y-6 mb-12">
            {[
              { q: 'Is this production ready?', a: 'Aperture is deployed on Solana Devnet with real RISC Zero production proofs (255KB receipts). The architecture is production-grade but the deployment is on Devnet for testing purposes.' },
              { q: 'Which wallets are supported?', a: 'Any Solana wallet that supports the Wallet Adapter standard: Phantom, Solflare, Backpack, Glow, and others. The dashboard uses sendTransaction which works with all adapters.' },
              { q: 'How long does proof generation take?', a: 'First proof: ~5 minutes on CPU (ELF compilation + proving). Subsequent proofs: ~6 seconds (warm cache). With GPU acceleration (CUDA/Metal), proving drops to 10-30 seconds.' },
              { q: 'What tokens are supported?', a: 'USDC and USDT on Devnet. vUSDC (SPL Token-2022 with transfer hook) for compliance-enforced transfers. Any SPL token can be added to the whitelist.' },
              { q: 'How does the transfer hook work?', a: 'vUSDC has an on-chain transfer hook that checks the ComplianceStatus PDA of the sender. If no verified compliance record exists, the transfer is rejected by the Token-2022 program.' },
              { q: 'What is Light Protocol ZK Compression?', a: 'Light Protocol stores proof records as compressed tokens instead of regular Solana accounts, reducing storage costs by 146x (~0.00001 SOL vs ~0.00146 SOL per proof).' },
              { q: 'How does the autonomous agent work?', a: 'The Aperture agent runs headless with a server-side Keypair. It loads policies from the Policy Service, generates ZK proofs via RISC Zero, pays via x402 (USDC on Solana) and MPP (Stripe), submits proof records, and anchors batch attestations on Solana. The Agent Service (port 3004) provides HTTP Start/Stop control with a 30-second cycle interval.' },
            ].map(({ q, a }) => (
              <div key={q}>
                <h4 className="text-sm font-semibold text-amber-100 mb-1">{q}</h4>
                <p className="text-xs text-amber-100/50 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>

        </main>
      </div>
    </div>
  );
}
