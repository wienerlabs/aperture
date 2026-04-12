use crate::error::{ProverError, ProverResult};
use crate::hasher::{compute_journal_digest, compute_proof_hash};
use crate::types::{
    AmountRange, CircuitPolicyInput, PaymentInput, ProofRequest, ProofResult, ProverInput,
    ProverOutput, ProverServiceConfig,
};
use chrono::Utc;
use reqwest::Client;
use std::time::Duration;

/// ProverClient serves as the interface between payment adapters and the RISC Zero zkVM.
/// In Phase 2, this will connect to the actual RISC Zero proving service.
pub struct ProverClient {
    config: ProverServiceConfig,
    http_client: Client,
}

impl ProverClient {
    pub fn new(config: ProverServiceConfig) -> ProverResult<Self> {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(ProverError::HttpRequest)?;

        Ok(Self {
            config,
            http_client,
        })
    }

    /// Build a ProverInput from a compiled policy and payment data.
    pub fn build_prover_input(
        &self,
        policy: &CircuitPolicyInput,
        payment: &PaymentInput,
        daily_spent_so_far_lamports: u64,
    ) -> ProverResult<ProverInput> {
        if policy.token_whitelist.is_empty() {
            return Err(ProverError::PolicyValidation {
                reason: "Token whitelist cannot be empty".to_string(),
            });
        }

        if policy.allowed_endpoint_categories.is_empty() {
            return Err(ProverError::PolicyValidation {
                reason: "Allowed endpoint categories cannot be empty".to_string(),
            });
        }

        if payment.amount_lamports.parse::<u64>().is_err() {
            return Err(ProverError::InvalidInput {
                field: "amount_lamports".to_string(),
                reason: "Must be a valid u64 string".to_string(),
            });
        }

        Ok(ProverInput {
            policy_id: policy.policy_id.clone(),
            operator_id: policy.operator_id.clone(),
            max_daily_spend_lamports: policy.max_daily_spend_lamports.clone(),
            max_per_transaction_lamports: policy.max_per_transaction_lamports.clone(),
            allowed_endpoint_categories: policy.allowed_endpoint_categories.clone(),
            blocked_addresses: policy.blocked_addresses.clone(),
            time_restrictions: policy.time_restrictions.clone(),
            token_whitelist: policy.token_whitelist.clone(),
            payment_amount_lamports: payment.amount_lamports.clone(),
            payment_token_mint: payment.token_mint.clone(),
            payment_recipient: payment.recipient_address.clone(),
            payment_endpoint_category: payment.endpoint_category.clone(),
            payment_timestamp: payment.timestamp.clone(),
            daily_spent_so_far_lamports: daily_spent_so_far_lamports.to_string(),
        })
    }

    /// Submit a proof request to the RISC Zero prover service.
    /// Sends the input to the real zkVM prover-service (port 3003) for proof generation.
    pub async fn generate_proof(&self, request: &ProofRequest) -> ProverResult<ProofResult> {
        let response = self
            .http_client
            .post(format!("{}/prove", self.config.endpoint))
            .json(request)
            .send()
            .await
            .map_err(|e| ProverError::ServiceUnavailable(e.to_string()))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(ProverError::ProofGeneration {
                reason: format!("Prover returned {}: {}", status, body),
            });
        }

        response
            .json::<ProofResult>()
            .await
            .map_err(ProverError::HttpRequest)
    }

    /// Build a ProofRequest from a ProverInput for sending to the prover service.
    pub fn build_proof_request(&self, input: &ProverInput) -> ProverResult<ProofRequest> {
        let amount = input.payment_amount_lamports.parse::<u64>().map_err(|_| {
            ProverError::InvalidInput {
                field: "payment_amount_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            }
        })?;
        let max_daily = input.max_daily_spend_lamports.parse::<u64>().map_err(|_| {
            ProverError::InvalidInput {
                field: "max_daily_spend_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            }
        })?;
        let max_per_tx = input.max_per_transaction_lamports.parse::<u64>().map_err(|_| {
            ProverError::InvalidInput {
                field: "max_per_transaction_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            }
        })?;
        let daily_spent = input.daily_spent_so_far_lamports.parse::<u64>().map_err(|_| {
            ProverError::InvalidInput {
                field: "daily_spent_so_far_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            }
        })?;

        Ok(ProofRequest {
            policy_id: input.policy_id.clone(),
            operator_id: input.operator_id.clone(),
            max_daily_spend_lamports: max_daily,
            max_per_transaction_lamports: max_per_tx,
            allowed_endpoint_categories: input.allowed_endpoint_categories.clone(),
            blocked_addresses: input.blocked_addresses.clone(),
            token_whitelist: input.token_whitelist.clone(),
            payment_amount_lamports: amount,
            payment_token_mint: input.payment_token_mint.clone(),
            payment_recipient: input.payment_recipient.clone(),
            payment_endpoint_category: input.payment_endpoint_category.clone(),
            payment_timestamp: input.payment_timestamp.clone(),
            daily_spent_so_far_lamports: daily_spent,
        })
    }

    /// Perform local compliance checks before sending to the prover service.
    /// Returns a ProverOutput with local verification results.
    pub fn verify_compliance_locally(&self, input: &ProverInput) -> ProverResult<ProverOutput> {
        let amount = input
            .payment_amount_lamports
            .parse::<u64>()
            .map_err(|_| ProverError::InvalidInput {
                field: "payment_amount_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            })?;

        let max_per_tx = input
            .max_per_transaction_lamports
            .parse::<u64>()
            .map_err(|_| ProverError::InvalidInput {
                field: "max_per_transaction_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            })?;

        let max_daily = input
            .max_daily_spend_lamports
            .parse::<u64>()
            .map_err(|_| ProverError::InvalidInput {
                field: "max_daily_spend_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            })?;

        let daily_spent = input
            .daily_spent_so_far_lamports
            .parse::<u64>()
            .map_err(|_| ProverError::InvalidInput {
                field: "daily_spent_so_far_lamports".to_string(),
                reason: "Invalid u64".to_string(),
            })?;

        // Check per-transaction limit
        if amount > max_per_tx {
            return Ok(self.build_non_compliant_output(input, "Exceeds per-transaction limit"));
        }

        // Check daily spend limit
        if daily_spent + amount > max_daily {
            return Ok(self.build_non_compliant_output(input, "Exceeds daily spend limit"));
        }

        // Check token whitelist
        if !input.token_whitelist.contains(&input.payment_token_mint) {
            return Ok(self.build_non_compliant_output(input, "Token not in whitelist"));
        }

        // Check blocked addresses
        if input.blocked_addresses.contains(&input.payment_recipient) {
            return Ok(self.build_non_compliant_output(input, "Recipient is on blocked list"));
        }

        // Check endpoint category
        if !input
            .allowed_endpoint_categories
            .contains(&input.payment_endpoint_category)
        {
            return Ok(self.build_non_compliant_output(input, "Endpoint category not allowed"));
        }

        // All checks passed - build compliant output
        let input_json = serde_json::to_string(input)?;
        let proof_hash = compute_proof_hash(&input_json);
        let now = Utc::now().to_rfc3339();
        let range = AmountRange::from_amount(amount, 1_000_000);

        let journal_digest = compute_journal_digest(
            true,
            &proof_hash,
            &range.min.to_string(),
            &range.max.to_string(),
            &now,
        );

        Ok(ProverOutput {
            is_compliant: true,
            proof_hash,
            amount_range_min: range.min.to_string(),
            amount_range_max: range.max.to_string(),
            verification_timestamp: now,
            journal_digest,
        })
    }

    fn build_non_compliant_output(&self, input: &ProverInput, _reason: &str) -> ProverOutput {
        let input_json = serde_json::to_string(input).unwrap_or_default();
        let proof_hash = compute_proof_hash(&input_json);
        let now = Utc::now().to_rfc3339();

        let journal_digest = compute_journal_digest(false, &proof_hash, "0", "0", &now);

        ProverOutput {
            is_compliant: false,
            proof_hash,
            amount_range_min: "0".to_string(),
            amount_range_max: "0".to_string(),
            verification_timestamp: now,
            journal_digest,
        }
    }

    /// Verify a proof result against expected values.
    pub fn verify_proof_output(&self, output: &ProverOutput) -> ProverResult<bool> {
        let expected_digest = compute_journal_digest(
            output.is_compliant,
            &output.proof_hash,
            &output.amount_range_min,
            &output.amount_range_max,
            &output.verification_timestamp,
        );

        if expected_digest != output.journal_digest {
            return Err(ProverError::VerificationFailed {
                reason: "Journal digest mismatch".to_string(),
            });
        }

        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::TimeRestriction;

    fn test_config() -> ProverServiceConfig {
        ProverServiceConfig {
            endpoint: "http://localhost:50051".to_string(),
            timeout_secs: 30,
        }
    }

    fn test_policy() -> CircuitPolicyInput {
        CircuitPolicyInput {
            policy_id: "policy-1".to_string(),
            operator_id: "operator-1".to_string(),
            max_daily_spend_lamports: "100000000".to_string(),
            max_per_transaction_lamports: "10000000".to_string(),
            allowed_endpoint_categories: vec!["compute".to_string(), "storage".to_string()],
            blocked_addresses: vec!["BlockedAddr111111111111111111111111111111111".to_string()],
            time_restrictions: vec![TimeRestriction {
                allowed_days: vec![
                    "monday".to_string(),
                    "tuesday".to_string(),
                    "wednesday".to_string(),
                    "thursday".to_string(),
                    "friday".to_string(),
                ],
                allowed_hours_start: 0,
                allowed_hours_end: 23,
                timezone: "UTC".to_string(),
            }],
            token_whitelist: vec![
                "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_string(),
            ],
            version: 1,
            compiled_at: "2026-04-01T00:00:00Z".to_string(),
        }
    }

    fn test_payment() -> PaymentInput {
        PaymentInput {
            payment_id: "pay-1".to_string(),
            sender_address: "SenderAddr111111111111111111111111111111111".to_string(),
            recipient_address: "RecipientAddr11111111111111111111111111111".to_string(),
            amount_lamports: "5000000".to_string(),
            token_mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".to_string(),
            endpoint_category: "compute".to_string(),
            memo: "AI agent compute payment".to_string(),
            timestamp: "2026-04-01T12:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_build_prover_input() {
        let client = ProverClient::new(test_config()).unwrap();
        let input = client
            .build_prover_input(&test_policy(), &test_payment(), 50_000_000)
            .unwrap();
        assert_eq!(input.policy_id, "policy-1");
        assert_eq!(input.payment_amount_lamports, "5000000");
        assert_eq!(input.daily_spent_so_far_lamports, "50000000");
    }

    #[test]
    fn test_verify_compliance_locally_compliant() {
        let client = ProverClient::new(test_config()).unwrap();
        let input = client
            .build_prover_input(&test_policy(), &test_payment(), 50_000_000)
            .unwrap();
        let output = client.verify_compliance_locally(&input).unwrap();
        assert!(output.is_compliant);
        assert!(!output.proof_hash.is_empty());
    }

    #[test]
    fn test_verify_compliance_exceeds_per_tx_limit() {
        let client = ProverClient::new(test_config()).unwrap();
        let mut payment = test_payment();
        payment.amount_lamports = "99999999".to_string();
        let input = client
            .build_prover_input(&test_policy(), &payment, 0)
            .unwrap();
        let output = client.verify_compliance_locally(&input).unwrap();
        assert!(!output.is_compliant);
    }

    #[test]
    fn test_verify_compliance_exceeds_daily_limit() {
        let client = ProverClient::new(test_config()).unwrap();
        let input = client
            .build_prover_input(&test_policy(), &test_payment(), 99_000_000)
            .unwrap();
        let output = client.verify_compliance_locally(&input).unwrap();
        assert!(!output.is_compliant);
    }

    #[test]
    fn test_verify_compliance_blocked_address() {
        let client = ProverClient::new(test_config()).unwrap();
        let mut payment = test_payment();
        payment.recipient_address =
            "BlockedAddr111111111111111111111111111111111".to_string();
        let input = client
            .build_prover_input(&test_policy(), &payment, 0)
            .unwrap();
        let output = client.verify_compliance_locally(&input).unwrap();
        assert!(!output.is_compliant);
    }

    #[test]
    fn test_verify_compliance_wrong_token() {
        let client = ProverClient::new(test_config()).unwrap();
        let mut payment = test_payment();
        payment.token_mint = "InvalidMint1111111111111111111111111111111111".to_string();
        let input = client
            .build_prover_input(&test_policy(), &payment, 0)
            .unwrap();
        let output = client.verify_compliance_locally(&input).unwrap();
        assert!(!output.is_compliant);
    }

    #[test]
    fn test_verify_compliance_wrong_category() {
        let client = ProverClient::new(test_config()).unwrap();
        let mut payment = test_payment();
        payment.endpoint_category = "gambling".to_string();
        let input = client
            .build_prover_input(&test_policy(), &payment, 0)
            .unwrap();
        let output = client.verify_compliance_locally(&input).unwrap();
        assert!(!output.is_compliant);
    }

    #[test]
    fn test_verify_proof_output() {
        let client = ProverClient::new(test_config()).unwrap();
        let input = client
            .build_prover_input(&test_policy(), &test_payment(), 0)
            .unwrap();
        let output = client.verify_compliance_locally(&input).unwrap();
        assert!(client.verify_proof_output(&output).unwrap());
    }
}
