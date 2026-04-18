use anyhow::{Context, Result};
use risc0_zkvm::{default_prover, ExecutorEnv, Receipt};
use aperture_batch_aggregator_core::{BatchAggregatorInput, BatchAggregatorOutput};
use aperture_batch_aggregator_methods::GUEST_CODE_FOR_Aperture_BATCH_AGGREGATOR_GUEST_ID;

pub struct BatchAggregator;

pub struct BatchProofResult {
    pub output: BatchAggregatorOutput,
    pub receipt: Receipt,
    pub image_id: [u32; 8],
}

impl BatchAggregator {
    pub fn prove(input: &BatchAggregatorInput) -> Result<BatchProofResult> {
        let env = ExecutorEnv::builder()
            .write(input)
            .context("Failed to write input to executor env")?
            .build()
            .context("Failed to build executor env")?;

        let prover = default_prover();
        let receipt = prover
            .prove(env, GUEST_CODE_FOR_Aperture_BATCH_AGGREGATOR_GUEST_ID)
            .context("Failed to generate batch proof")?
            .receipt;

        let output: BatchAggregatorOutput = receipt
            .journal
            .decode()
            .context("Failed to decode batch journal output")?;

        receipt
            .verify(GUEST_CODE_FOR_Aperture_BATCH_AGGREGATOR_GUEST_ID)
            .context("Batch receipt verification failed")?;

        Ok(BatchProofResult {
            output,
            receipt,
            image_id: GUEST_CODE_FOR_Aperture_BATCH_AGGREGATOR_GUEST_ID,
        })
    }

    pub fn verify(receipt: &Receipt) -> Result<BatchAggregatorOutput> {
        receipt
            .verify(GUEST_CODE_FOR_Aperture_BATCH_AGGREGATOR_GUEST_ID)
            .context("Batch receipt verification failed")?;

        let output: BatchAggregatorOutput = receipt
            .journal
            .decode()
            .context("Failed to decode batch journal output")?;

        Ok(output)
    }

    pub fn image_id() -> [u32; 8] {
        GUEST_CODE_FOR_Aperture_BATCH_AGGREGATOR_GUEST_ID
    }
}
