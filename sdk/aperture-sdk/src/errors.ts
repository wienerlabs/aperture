/** Base class for all Aperture SDK errors. */
export class ApertureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApertureError';
  }
}

/** Thrown when policy lookup, compilation, or on-chain anchoring is missing. */
export class PolicyError extends ApertureError {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyError';
  }
}

/** Thrown when a payment request is blocked by local policy checks. */
export class PolicyViolationError extends ApertureError {
  readonly reason: string;
  constructor(reason: string) {
    super(`Payment blocked by policy: ${reason}`);
    this.name = 'PolicyViolationError';
    this.reason = reason;
  }
}

/** Thrown when the prover-service rejects a request or returns is_compliant=false. */
export class ProverError extends ApertureError {
  constructor(message: string) {
    super(message);
    this.name = 'ProverError';
  }
}

/** Thrown when the on-chain submission of a verify/transfer instruction fails. */
export class OnChainError extends ApertureError {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'OnChainError';
    this.cause = cause;
  }
}

/** Thrown when an HTTP 402 challenge body is missing the required fields. */
export class ChallengeError extends ApertureError {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeError';
  }
}

/** Thrown when the Stripe confirm step or the post-confirm attestation polling fails. */
export class StripeError extends ApertureError {
  constructor(message: string) {
    super(message);
    this.name = 'StripeError';
  }
}
