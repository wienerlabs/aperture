use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProverOutputEntry {
    pub is_compliant: bool,
    pub proof_hash: String,
    pub amount_range_min: u64,
    pub amount_range_max: u64,
    pub policy_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchAggregatorInput {
    pub operator_id: String,
    pub policy_id: String,
    pub period_start: String,
    pub period_end: String,
    pub proof_outputs: Vec<ProverOutputEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchAggregatorOutput {
    pub operator_id: String,
    pub policy_id: String,
    pub period_start: String,
    pub period_end: String,
    pub total_payments: u32,
    pub total_amount_range_min: u64,
    pub total_amount_range_max: u64,
    pub policy_violations: u32,
    pub sanctions_intersections: u32,
    pub batch_hash: String,
    pub journal_digest: String,
}

pub fn compute_batch_hash(proof_hashes: &[String]) -> String {
    let mut sorted = proof_hashes.to_vec();
    sorted.sort();
    let concatenated = sorted.join(":");
    let mut hasher = Sha256::new();
    hasher.update(concatenated.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn compute_batch_journal_digest(output: &BatchAggregatorOutput) -> String {
    let data = format!(
        "{}:{}:{}:{}:{}:{}:{}:{}:{}:{}",
        output.operator_id,
        output.policy_id,
        output.period_start,
        output.period_end,
        output.total_payments,
        output.total_amount_range_min,
        output.total_amount_range_max,
        output.policy_violations,
        output.sanctions_intersections,
        output.batch_hash,
    );
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn aggregate_proofs(input: &BatchAggregatorInput) -> BatchAggregatorOutput {
    let mut total_amount_min: u64 = 0;
    let mut total_amount_max: u64 = 0;
    let mut violations: u32 = 0;
    let mut proof_hashes: Vec<String> = Vec::with_capacity(input.proof_outputs.len());

    for entry in &input.proof_outputs {
        assert_eq!(
            entry.policy_id, input.policy_id,
            "All proofs must belong to the same policy"
        );

        if entry.is_compliant {
            total_amount_min = total_amount_min.saturating_add(entry.amount_range_min);
            total_amount_max = total_amount_max.saturating_add(entry.amount_range_max);
        } else {
            violations += 1;
        }

        proof_hashes.push(entry.proof_hash.clone());
    }

    let batch_hash = compute_batch_hash(&proof_hashes);

    let mut output = BatchAggregatorOutput {
        operator_id: input.operator_id.clone(),
        policy_id: input.policy_id.clone(),
        period_start: input.period_start.clone(),
        period_end: input.period_end.clone(),
        total_payments: input.proof_outputs.len() as u32,
        total_amount_range_min: total_amount_min,
        total_amount_range_max: total_amount_max,
        policy_violations: violations,
        sanctions_intersections: 0,
        batch_hash,
        journal_digest: String::new(),
    };

    output.journal_digest = compute_batch_journal_digest(&output);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input() -> BatchAggregatorInput {
        BatchAggregatorInput {
            operator_id: "op-1".to_string(),
            policy_id: "pol-1".to_string(),
            period_start: "2026-04-01T00:00:00Z".to_string(),
            period_end: "2026-04-02T00:00:00Z".to_string(),
            proof_outputs: vec![
                ProverOutputEntry {
                    is_compliant: true,
                    proof_hash: "aaa".to_string(),
                    amount_range_min: 1_000_000,
                    amount_range_max: 2_000_000,
                    policy_id: "pol-1".to_string(),
                },
                ProverOutputEntry {
                    is_compliant: true,
                    proof_hash: "bbb".to_string(),
                    amount_range_min: 3_000_000,
                    amount_range_max: 4_000_000,
                    policy_id: "pol-1".to_string(),
                },
            ],
        }
    }

    #[test]
    fn test_aggregate_all_compliant() {
        let output = aggregate_proofs(&sample_input());
        assert_eq!(output.total_payments, 2);
        assert_eq!(output.total_amount_range_min, 4_000_000);
        assert_eq!(output.total_amount_range_max, 6_000_000);
        assert_eq!(output.policy_violations, 0);
        assert_eq!(output.sanctions_intersections, 0);
        assert!(!output.batch_hash.is_empty());
        assert!(!output.journal_digest.is_empty());
    }

    #[test]
    fn test_aggregate_with_violation() {
        let mut input = sample_input();
        input.proof_outputs[1].is_compliant = false;
        let output = aggregate_proofs(&input);
        assert_eq!(output.total_payments, 2);
        assert_eq!(output.policy_violations, 1);
        assert_eq!(output.total_amount_range_min, 1_000_000);
        assert_eq!(output.total_amount_range_max, 2_000_000);
    }

    #[test]
    fn test_batch_hash_order_independent() {
        let h1 = compute_batch_hash(&["b".to_string(), "a".to_string()]);
        let h2 = compute_batch_hash(&["a".to_string(), "b".to_string()]);
        assert_eq!(h1, h2);
    }
}
