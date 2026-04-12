use serde::{Deserialize, Serialize};

/// Time restriction for policy enforcement
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimeRestriction {
    pub allowed_days: Vec<String>,
    pub allowed_hours_start: u8,
    pub allowed_hours_end: u8,
    pub timezone: String,
}

/// Policy input compiled for the RISC Zero circuit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitPolicyInput {
    pub policy_id: String,
    pub operator_id: String,
    pub max_daily_spend_lamports: String,
    pub max_per_transaction_lamports: String,
    pub allowed_endpoint_categories: Vec<String>,
    pub blocked_addresses: Vec<String>,
    pub time_restrictions: Vec<TimeRestriction>,
    pub token_whitelist: Vec<String>,
    pub version: u32,
    pub compiled_at: String,
}

/// Payment data input for the prover
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaymentInput {
    pub payment_id: String,
    pub sender_address: String,
    pub recipient_address: String,
    pub amount_lamports: String,
    pub token_mint: String,
    pub endpoint_category: String,
    pub memo: String,
    pub timestamp: String,
}

/// Complete input for the RISC Zero guest program
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProverInput {
    pub policy_id: String,
    pub operator_id: String,
    pub max_daily_spend_lamports: String,
    pub max_per_transaction_lamports: String,
    pub allowed_endpoint_categories: Vec<String>,
    pub blocked_addresses: Vec<String>,
    pub time_restrictions: Vec<TimeRestriction>,
    pub token_whitelist: Vec<String>,
    pub payment_amount_lamports: String,
    pub payment_token_mint: String,
    pub payment_recipient: String,
    pub payment_endpoint_category: String,
    pub payment_timestamp: String,
    pub daily_spent_so_far_lamports: String,
}

/// Output from the RISC Zero guest program (journal)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProverOutput {
    pub is_compliant: bool,
    pub proof_hash: String,
    pub amount_range_min: String,
    pub amount_range_max: String,
    pub verification_timestamp: String,
    pub journal_digest: String,
}

/// Proof request sent to the prover service (matches prover-service ProveRequest)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofRequest {
    pub policy_id: String,
    pub operator_id: String,
    pub max_daily_spend_lamports: u64,
    pub max_per_transaction_lamports: u64,
    pub allowed_endpoint_categories: Vec<String>,
    pub blocked_addresses: Vec<String>,
    pub token_whitelist: Vec<String>,
    pub payment_amount_lamports: u64,
    pub payment_token_mint: String,
    pub payment_recipient: String,
    pub payment_endpoint_category: String,
    pub payment_timestamp: String,
    pub daily_spent_so_far_lamports: u64,
}

/// Complete proof result with receipt data (matches prover-service ProveResponse)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofResult {
    pub is_compliant: bool,
    pub proof_hash: String,
    pub amount_range_min: u64,
    pub amount_range_max: u64,
    pub verification_timestamp: String,
    pub journal_digest: String,
    pub receipt_bytes: Vec<u8>,
    pub image_id: [u32; 8],
    pub proving_time_ms: u64,
}

/// Amount range for privacy-preserving attestation
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AmountRange {
    pub min: u64,
    pub max: u64,
}

impl AmountRange {
    /// Compute a privacy-preserving range that contains the actual amount.
    /// Uses bucket rounding: the range spans from the nearest lower bucket
    /// boundary to the nearest upper bucket boundary.
    pub fn from_amount(amount_lamports: u64, bucket_size: u64) -> Self {
        let min = (amount_lamports / bucket_size) * bucket_size;
        let max = min + bucket_size;
        Self { min, max }
    }
}

/// Configuration for connecting to the prover service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProverServiceConfig {
    pub endpoint: String,
    pub timeout_secs: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_amount_range_bucketing() {
        let range = AmountRange::from_amount(1_500_000, 1_000_000);
        assert_eq!(range, AmountRange { min: 1_000_000, max: 2_000_000 });
    }

    #[test]
    fn test_amount_range_exact_boundary() {
        let range = AmountRange::from_amount(2_000_000, 1_000_000);
        assert_eq!(range, AmountRange { min: 2_000_000, max: 3_000_000 });
    }

    #[test]
    fn test_amount_range_zero() {
        let range = AmountRange::from_amount(0, 1_000_000);
        assert_eq!(range, AmountRange { min: 0, max: 1_000_000 });
    }

    #[test]
    fn test_prover_input_serialization() {
        let input = ProverInput {
            policy_id: "test-policy".to_string(),
            operator_id: "test-operator".to_string(),
            max_daily_spend_lamports: "100000000".to_string(),
            max_per_transaction_lamports: "10000000".to_string(),
            allowed_endpoint_categories: vec!["compute".to_string(), "storage".to_string()],
            blocked_addresses: vec![],
            time_restrictions: vec![TimeRestriction {
                allowed_days: vec!["monday".to_string(), "friday".to_string()],
                allowed_hours_start: 9,
                allowed_hours_end: 17,
                timezone: "UTC".to_string(),
            }],
            token_whitelist: vec!["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_string()],
            payment_amount_lamports: "5000000".to_string(),
            payment_token_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_string(),
            payment_recipient: "RecipientPubkey111111111111111111111111111111".to_string(),
            payment_endpoint_category: "compute".to_string(),
            payment_timestamp: "2026-04-01T12:00:00Z".to_string(),
            daily_spent_so_far_lamports: "50000000".to_string(),
        };

        let json = serde_json::to_string(&input).unwrap();
        let deserialized: ProverInput = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.policy_id, "test-policy");
        assert_eq!(deserialized.allowed_endpoint_categories.len(), 2);
    }
}
