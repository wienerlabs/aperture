# Aperture Prover Client

Rust library serving as the interface between payment adapters and the RISC Zero zkVM. Defines all input/output types for the circuit, performs local compliance checks, and communicates with the prover service.

## Build

```bash
cargo build
cargo test
```

## Architecture

```
ProverClient
├── build_prover_input()        Assembles circuit input from policy + payment data
├── verify_compliance_locally() Pre-flight compliance checks (all policy rules)
├── generate_proof()            Submits to RISC Zero prover service (Phase 2)
└── verify_proof_output()       Validates proof journal digest integrity
```

## Types

### ProverInput
Complete input for the RISC Zero guest program:
- Policy constraints (limits, categories, blocked addresses, time restrictions, token whitelist)
- Payment details (amount, token, recipient, category, timestamp)
- Current daily spend accumulator

### ProverOutput
Circuit journal output:
- `is_compliant` - Whether all policy checks passed
- `proof_hash` - SHA-256 of the serialized input
- `amount_range_min/max` - Privacy-preserving amount bucket
- `verification_timestamp` - When proof was generated
- `journal_digest` - Integrity hash of all output fields

## Local Compliance Checks

The `verify_compliance_locally` method performs the same checks the RISC Zero circuit will execute:
1. Per-transaction amount limit
2. Daily spending limit (accumulated + current)
3. Token whitelist membership
4. Blocked address (sanctions) check
5. Endpoint category allowlist

## Privacy

Amounts are bucketed into ranges (default 1 USDC/USDT buckets) so attestations reveal approximate totals without exposing exact payment values.
