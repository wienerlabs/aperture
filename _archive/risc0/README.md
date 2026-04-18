# RISC Zero Archive

This folder preserves the original RISC Zero zkVM implementation that powered
the Aperture payment prover before the migration to Circom + snarkjs.

## Why archived

RISC Zero Groth16 compression requires Docker + x86_64 Linux, which is
incompatible with Railway deployment. The project moved to a Circom-based
prover that generates Groth16 proofs without exotic infrastructure requirements,
while keeping the same `groth16-solana` on-chain verifier.

## What is here

```
_archive/risc0/
├── circuits/
│   ├── payment-prover/       # RISC Zero guest program for policy compliance
│   └── batch-aggregator/     # RISC Zero guest program for batch attestations
└── services/
    └── prover-service/       # Rust/Actix HTTP server wrapping the zkVM
```

The relative Cargo path references inside `prover-service/Cargo.toml`
(`../../circuits/payment-prover/core`, etc.) still resolve correctly within
this archive layout, so the code compiles as-is.

## How to restore

If the Circom approach turns out to be the wrong direction and you need to
revive RISC Zero:

```bash
# From the repo root:
git mv _archive/risc0/circuits/payment-prover    circuits/payment-prover
git mv _archive/risc0/circuits/batch-aggregator  circuits/batch-aggregator
git mv _archive/risc0/services/prover-service    services/prover-service
rmdir _archive/risc0/circuits _archive/risc0/services
# Optionally: rm -rf _archive/risc0
```

After restoring, the existing `services/prover-service/Cargo.toml` paths work
without modification and Railway will rebuild the service from the repo root
as before.

## Git history

All commits that created or modified this code are preserved in the main
branch history. Use `git log --follow _archive/risc0/<path>` to trace the
origin of any file back through its pre-archive location.
