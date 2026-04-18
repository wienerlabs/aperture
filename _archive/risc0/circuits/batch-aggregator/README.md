# Aperture Batch Aggregator Circuit

RISC Zero zkVM circuit that aggregates multiple payment proof outputs into a single batch attestation.

## Structure

```
batch-aggregator/
├── core/       Shared types and aggregation logic
├── methods/    RISC Zero guest program
└── host/       Host program (prover + verifier)
```

## What It Proves

- All proof outputs belong to the same policy_id
- Total payment count is accurate
- Amount ranges are correctly summed (privacy-preserving min/max)
- Policy violations count is correct
- Sanctions intersections count is zero
- Batch hash is the SHA-256 of all sorted proof hashes

## Build

```bash
cargo build
cargo test -p aperture-batch-aggregator-core
```

## Input/Output

**BatchAggregatorInput**: operator_id, policy_id, period, list of ProverOutputEntry
**BatchAggregatorOutput**: Aggregated totals with batch_hash and journal_digest
