import { PublicKey } from '@solana/web3.js';

/**
 * Aperture verifier program (Anchor). Owns ProofRecord, ComplianceStatus, and
 * OperatorState PDAs and runs Groth16 verification via alt_bn128 syscalls.
 */
export const DEFAULT_VERIFIER_PROGRAM = new PublicKey(
  'AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU',
);

/**
 * Policy registry program (Anchor). Owns Operator and Policy PDAs that store
 * each operator's Merkle-rooted policy on-chain.
 */
export const DEFAULT_POLICY_REGISTRY_PROGRAM = new PublicKey(
  'FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU',
);

/**
 * Sysvar account that exposes the current transaction's instruction list to
 * Anchor programs. The MPP verifier reads it to authenticate the preceding
 * Ed25519 signature instruction.
 */
export const SYSVAR_INSTRUCTIONS_PUBKEY = new PublicKey(
  'Sysvar1nstructions1111111111111111111111111',
);

/**
 * SPL Token-2022 program ID. The verify+transfer instruction CPIs into it for
 * Token-2022 mints (e.g. aUSDC with the Aperture transfer-hook).
 */
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
);

/**
 * Number of Groth16 public inputs the payment circuit produces. Indices:
 *   [0] is_compliant
 *   [1] policy_data_hash
 *   [2] recipient_high
 *   [3] recipient_low
 *   [4] amount_lamports
 *   [5] token_mint_high
 *   [6] token_mint_low
 *   [7] daily_spent_before
 *   [8] current_unix_timestamp
 *   [9] stripe_receipt_hash
 */
export const PAYMENT_PUBLIC_INPUTS = 10;

/**
 * Anchor instruction discriminators. Pinned to the SHA-256 outputs computed
 * when the corresponding handlers were written. Anything that drifts here
 * surfaces immediately as InstructionFallbackNotFound on-chain, not silent
 * payload corruption.
 */
export const DISCRIMINATORS = {
  // verifier program
  verifyPaymentProofV2: new Uint8Array([15, 218, 30, 217, 205, 0, 219, 86]),
  verifyPaymentProofV2WithTransfer: new Uint8Array([
    135, 175, 216, 175, 66, 118, 196, 204,
  ]),
  verifyMppPaymentProof: new Uint8Array([91, 1, 37, 88, 220, 232, 8, 48]),
  verifyBatchAttestation: new Uint8Array([85, 129, 17, 164, 94, 99, 86, 45]),
  operatorState: new Uint8Array([253, 164, 195, 158, 226, 13, 170, 145]),
  // policy-registry program
  initializeOperator: new Uint8Array([155, 33, 216, 254, 233, 227, 175, 212]),
  registerPolicy: new Uint8Array([62, 66, 167, 36, 252, 227, 38, 132]),
  updatePolicy: new Uint8Array([212, 245, 246, 7, 163, 151, 18, 57]),
  deactivatePolicy: new Uint8Array([210, 232, 122, 110, 223, 75, 16, 26]),
} as const;
