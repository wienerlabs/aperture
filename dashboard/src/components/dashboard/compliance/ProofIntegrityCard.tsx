'use client';

/**
 * ProofIntegrityCard — surfaces the cryptographic guarantees behind every
 * attestation. Shown alongside the Merkle viewer so operators understand
 * exactly what they're signing onto when they anchor a batch on-chain.
 */

import { CheckCircle2, Hash, Network, Shield } from 'lucide-react';

const FACTS = [
  {
    icon: Hash,
    label: 'Poseidon commitment',
    body: 'Every rule value is hashed inside the circuit so the on-chain leaf only proves existence — not the value itself.',
  },
  {
    icon: Shield,
    label: 'Groth16 verification',
    body: 'Proofs are verified via alt_bn128 syscalls inside the verifier program. ~256-byte proof, ~200K compute units.',
  },
  {
    icon: Network,
    label: 'Atomic settlement',
    body: 'verify_payment_proof_v2_with_transfer mutates daily_spent and signs the inner SPL transfer in one tx — no race window.',
  },
  {
    icon: CheckCircle2,
    label: 'Selective disclosure',
    body: 'An auditor can verify any single rule (e.g. blocked_addresses) without learning the values of the other rules.',
  },
] as const;

export function ProofIntegrityCard() {
  return (
    <div className="ap-card p-5 sm:p-6 flex flex-col gap-4">
      <header>
        <h3 className="font-display text-[18px] tracking-[-0.005em] text-black">
          Proof Integrity
        </h3>
        <p className="text-[12px] text-black/55 tracking-tighter mt-0.5">
          The cryptographic guarantees you&apos;re signing onto when you anchor a batch.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FACTS.map((fact) => (
          <li
            key={fact.label}
            className="flex items-start gap-3 rounded-[14px] border border-black/8 bg-[rgba(248,179,0,0.03)] px-3 py-3"
          >
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-aperture/12 text-aperture-dark">
              <fact.icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-black tracking-tighter">
                {fact.label}
              </div>
              <p className="text-[12px] text-black/65 tracking-tighter mt-0.5">
                {fact.body}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
