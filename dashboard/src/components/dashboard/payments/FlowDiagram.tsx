'use client';

/**
 * FlowDiagram — visualises the protocol-specific payment lifecycle as a
 * 4-step horizontal stepper. We render two variants:
 *   - "x402"  : 402 challenge -> ZK proof -> atomic verify+transfer -> retry
 *   - "mpp"   : 402 challenge -> Stripe charge -> ed25519 attestation -> on-chain
 *
 * Designed to slot inside the parent payment-method card so operators can
 * see the protocol shape at a glance without diving into the docs.
 */

import { type LucideIcon, FileText, ShieldCheck, Send, ArrowRight, CreditCard, Fingerprint, Anchor } from 'lucide-react';

interface FlowStep {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly hint: string;
}

const X402_STEPS: readonly FlowStep[] = [
  { icon: FileText, label: '402 Challenge', hint: 'Server returns x402 paymentRequirement' },
  { icon: ShieldCheck, label: 'Groth16 Proof', hint: 'Prover service builds compliant proof' },
  { icon: Send, label: 'Atomic verify+transfer', hint: 'verify_payment_proof_v2_with_transfer' },
  { icon: Anchor, label: 'Retry w/ payment', hint: 'Server returns 200 + report' },
];

const MPP_STEPS: readonly FlowStep[] = [
  { icon: FileText, label: '402 Challenge', hint: 'Stripe PaymentIntent client_secret' },
  { icon: CreditCard, label: 'Stripe charge', hint: 'Card confirmation via Stripe Elements' },
  { icon: Fingerprint, label: 'Ed25519 attestation', hint: 'Compliance API signs Poseidon receipt' },
  { icon: Anchor, label: 'verify_mpp_payment_proof', hint: 'Solana records ProofRecord PDA' },
];

export function FlowDiagram({ variant }: { variant: 'x402' | 'mpp' }) {
  const steps = variant === 'x402' ? X402_STEPS : MPP_STEPS;

  return (
    <ol className="flex items-stretch justify-between gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-1.5 shrink-0">
          <div className="flex flex-col items-start gap-1.5 min-w-[100px]">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
              <step.icon className="h-3.5 w-3.5" />
            </span>
            <div className="flex flex-col">
              <span className="text-[12px] font-medium text-black tracking-tighter leading-tight">
                {i + 1}. {step.label}
              </span>
              <span className="text-[11px] text-black/55 tracking-tighter leading-tight">
                {step.hint}
              </span>
            </div>
          </div>
          {i < steps.length - 1 && (
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-black/30 mt-3" />
          )}
        </li>
      ))}
    </ol>
  );
}
