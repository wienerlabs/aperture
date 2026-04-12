use risc0_zkvm::guest::env;
use aperture_batch_aggregator_core::{aggregate_proofs, BatchAggregatorInput, BatchAggregatorOutput};

fn main() {
    let input: BatchAggregatorInput = env::read();

    let output: BatchAggregatorOutput = aggregate_proofs(&input);

    env::commit(&output);
}
