use sha2::{Sha256, Digest};

/// Compute a SHA-256 hash of the given data and return it as a hex string.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

/// Compute a proof hash from prover input by hashing the serialized JSON.
pub fn compute_proof_hash(prover_input_json: &str) -> String {
    sha256_hex(prover_input_json.as_bytes())
}

/// Compute a batch hash from multiple proof hashes.
/// Sorts the hashes, concatenates with ':', and hashes the result.
pub fn compute_batch_hash(proof_hashes: &[String]) -> String {
    let mut sorted = proof_hashes.to_vec();
    sorted.sort();
    let concatenated = sorted.join(":");
    sha256_hex(concatenated.as_bytes())
}

/// Compute a journal digest from the prover output fields.
pub fn compute_journal_digest(
    is_compliant: bool,
    proof_hash: &str,
    amount_range_min: &str,
    amount_range_max: &str,
    verification_timestamp: &str,
) -> String {
    let data = format!(
        "{}:{}:{}:{}:{}",
        is_compliant, proof_hash, amount_range_min, amount_range_max, verification_timestamp
    );
    sha256_hex(data.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_hex() {
        let hash = sha256_hex(b"hello");
        assert_eq!(hash.len(), 64);
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_compute_batch_hash_is_order_independent() {
        let hashes_a = vec!["abc".to_string(), "def".to_string()];
        let hashes_b = vec!["def".to_string(), "abc".to_string()];
        assert_eq!(compute_batch_hash(&hashes_a), compute_batch_hash(&hashes_b));
    }

    #[test]
    fn test_compute_journal_digest() {
        let digest = compute_journal_digest(true, "abc123", "1000000", "2000000", "2026-04-01T00:00:00Z");
        assert_eq!(digest.len(), 64);
    }
}
