use thiserror::Error;

#[derive(Error, Debug)]
pub enum ProverError {
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("HTTP request failed: {0}")]
    HttpRequest(#[from] reqwest::Error),

    #[error("Proof generation failed: {reason}")]
    ProofGeneration { reason: String },

    #[error("Policy validation failed: {reason}")]
    PolicyValidation { reason: String },

    #[error("Invalid input: {field} - {reason}")]
    InvalidInput { field: String, reason: String },

    #[error("Prover service unavailable: {0}")]
    ServiceUnavailable(String),

    #[error("Proof verification failed: {reason}")]
    VerificationFailed { reason: String },
}

pub type ProverResult<T> = Result<T, ProverError>;
