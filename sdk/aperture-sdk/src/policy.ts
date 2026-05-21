import { PolicyError } from './errors.js';
import type {
  CompiledPolicy,
  LoadedPolicy,
  OnchainConfirmation,
  OnchainPayload,
  Policy,
  PolicyInput,
  PolicySummary,
  PolicyUpdate,
} from './types.js';

export interface PolicyClientOptions {
  /** Base URL of the policy-service. No trailing slash. */
  readonly baseUrl: string;
  /** Optional fetch override (used by tests). Defaults to globalThis.fetch. */
  readonly fetch?: typeof fetch;
}

/**
 * Thin HTTP client for the Aperture policy-service. Fetches an operator's
 * active policy, refuses to return one that has not been anchored on-chain
 * yet, and compiles it into the integer-lamports form the prover-service
 * expects.
 */
export class PolicyClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PolicyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * Fetches a single Policy row by ID. Use `loadActivePolicy` for the agent
   * runtime path — this method is the raw "look up by UUID" entry point.
   */
  async getPolicy(policyId: string): Promise<Policy> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/policies/${policyId}`,
    );
    if (!res.ok) {
      throw new PolicyError(
        `policy-service GET /policies/${policyId} returned HTTP ${res.status}`,
      );
    }
    const body = (await res.json()) as { readonly data: Policy };
    return body.data;
  }

  /**
   * Returns the operator's active policy, ready to feed to the prover. Throws
   * `PolicyError` when no active policy exists, when the policy has not been
   * anchored on-chain yet (the verifier would reject any proof bound to it),
   * or when policy-service responds with a non-2xx status.
   */
  async loadActivePolicy(operatorId: string): Promise<LoadedPolicy> {
    const listRes = await this.fetchImpl(
      `${this.baseUrl}/api/v1/policies/operator/${operatorId}?page=1&limit=1`,
    );
    if (!listRes.ok) {
      throw new PolicyError(
        `policy-service /policies/operator returned HTTP ${listRes.status}`,
      );
    }
    const listBody = (await listRes.json()) as {
      readonly data: readonly PolicySummary[];
    };
    if (listBody.data.length === 0) {
      throw new PolicyError(
        `No active policies for operator ${operatorId}. Create one from the Aperture dashboard before running the agent.`,
      );
    }
    const summary = listBody.data[0];
    if (summary.onchain_status !== 'registered' || !summary.onchain_pda) {
      throw new PolicyError(
        `Policy ${summary.id} is not anchored on-chain (status=${summary.onchain_status}). Anchor it from the dashboard first.`,
      );
    }
    const compiled = await this.compile(summary.id);
    return {
      id: summary.id,
      compiled,
      onchainPda: summary.onchain_pda,
      maxPerTxLamports: summary.max_per_transaction * 1_000_000,
      allowedCategories: summary.allowed_endpoint_categories,
      blockedAddresses: summary.blocked_addresses,
      tokenWhitelist: summary.token_whitelist,
    };
  }

  /**
   * Creates a new policy on the policy-service. Returns the persisted Policy
   * row with server-assigned UUID + Merkle commitments + initial
   * `onchain_status='pending'`. Call `OperatorAdmin.anchorPolicy(id)` next to
   * commit the Merkle root on Solana so the verifier accepts proofs against
   * it.
   */
  async createPolicy(input: PolicyInput): Promise<Policy> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/v1/policies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new PolicyError(
        `policy-service POST /policies returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { readonly data: Policy };
    return body.data;
  }

  /**
   * Updates an existing policy. Bumps the on-chain version counter and
   * resets `onchain_status` to `'pending'`; re-anchor with
   * `OperatorAdmin.anchorPolicy(id)` for the verifier to pick up the new
   * Merkle root.
   */
  async updatePolicy(policyId: string, update: PolicyUpdate): Promise<Policy> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/policies/${policyId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    );
    if (!res.ok) {
      throw new PolicyError(
        `policy-service PUT /policies/${policyId} returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { readonly data: Policy };
    return body.data;
  }

  /**
   * Hard-deletes a policy from the policy-service. Does NOT deactivate the
   * on-chain policy account; call `OperatorAdmin.deactivatePolicy` for the
   * on-chain mirror.
   */
  async deletePolicy(policyId: string): Promise<void> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/policies/${policyId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      throw new PolicyError(
        `policy-service DELETE /policies/${policyId} returned HTTP ${res.status}`,
      );
    }
  }

  /**
   * Fetches the canonical on-chain anchoring payload for a policy. The
   * policy-service is the only source of truth for Merkle root + policy_data
   * _hash; the SDK never recomputes them client-side so the verifier and the
   * DB cannot drift apart.
   */
  async getOnchainPayload(policyId: string): Promise<OnchainPayload> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/policies/${policyId}/onchain-payload`,
    );
    if (!res.ok) {
      throw new PolicyError(
        `policy-service GET /onchain-payload returned HTTP ${res.status}`,
      );
    }
    const body = (await res.json()) as { readonly data: OnchainPayload };
    return body.data;
  }

  /**
   * Reports the on-chain anchoring outcome (success or failure) back to the
   * policy-service so its DB mirrors the chain.
   */
  async confirmOnchain(
    policyId: string,
    confirmation: OnchainConfirmation,
  ): Promise<Policy> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/policies/${policyId}/onchain-confirmation`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(confirmation),
      },
    );
    if (!res.ok) {
      throw new PolicyError(
        `policy-service PATCH /onchain-confirmation returned HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const body = (await res.json()) as { readonly data: Policy };
    return body.data;
  }

  /**
   * Calls the policy-service compile endpoint, which converts the
   * human-friendly policy schema into integer lamports + canonical field
   * shapes consumable by the Circom witness.
   */
  async compile(policyId: string): Promise<CompiledPolicy> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/api/v1/policies/${policyId}/compile`,
    );
    if (!res.ok) {
      throw new PolicyError(
        `policy-service /compile returned HTTP ${res.status} for policy ${policyId}`,
      );
    }
    const body = (await res.json()) as { readonly data: CompiledPolicy };
    return body.data;
  }
}
