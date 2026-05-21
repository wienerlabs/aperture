import { Connection, Keypair, type ConnectionConfig } from '@solana/web3.js';
import type { ProgramIds } from './anchor/pda.js';
import type { HookExtraAccount } from './anchor/instructions.js';
import { PolicyClient } from './policy.js';
import { ProverClient } from './prover.js';
import { ComplianceClient } from './compliance.js';
import { OperatorAdmin, type AnchorPolicyResult } from './operator-admin.js';
import { AttestationFlow, type BatchAttestationResult } from './attestation.js';
import { Audit } from './audit.js';
import { X402Flow } from './x402.js';
import {
  MppFlow,
  createDashboardStripeCredentialsResolver,
  createStripeOffSessionConfirmer,
} from './mpp.js';
import type {
  LoadedPolicy,
  MppPaymentResult,
  Policy,
  PolicyInput,
  PolicyUpdate,
  StripeConfirmer,
  StripeCredentials,
  X402PaymentResult,
} from './types.js';

export interface ApertureClientConfig {
  /** Solana wallet that signs every Aperture instruction. */
  readonly wallet: Keypair;
  /** RPC URL or pre-built Connection. Devnet by default. */
  readonly rpcUrl?: string;
  readonly connection?: Connection;
  readonly connectionConfig?: ConnectionConfig;

  /** URLs of the three Aperture backend services. */
  readonly policyServiceUrl: string;
  readonly proverServiceUrl: string;
  readonly complianceApiUrl: string;

  /** Optional dashboard URL for audit link generation. */
  readonly dashboardUrl?: string;
  /** Solana cluster for explorer links. Defaults to 'devnet'. */
  readonly cluster?: 'devnet' | 'mainnet-beta' | 'testnet' | 'custom';

  /** Override Aperture program IDs (default = canonical devnet). */
  readonly programs?: ProgramIds;

  /** MPP-only: Stripe secret key for the default off_session confirmer. */
  readonly stripeSecretKey?: string;
  readonly stripeCredentialsResolver?: (
    operatorId: string,
  ) => Promise<StripeCredentials | null>;
  readonly stripeConfirmer?: StripeConfirmer;

  /** Optional Token-2022 transfer-hook account resolver (e.g. for aUSDC). */
  readonly hookAccountsResolver?: (
    mint: import('@solana/web3.js').PublicKey,
  ) => Promise<readonly HookExtraAccount[] | undefined>;

  readonly fetch?: typeof fetch;
}

/**
 * High-level entry point for AI agents that need to make Aperture-compliant
 * payments. Wires together the full lifecycle:
 *
 *   onboard:   client.operator.initializeOperator()
 *              client.policy.createPolicy(rules)
 *              client.operator.anchorPolicy(policyId)
 *
 *   pay:       const p = await client.loadActivePolicy()
 *              client.payX402(endpoint, p)
 *              client.payMpp(endpoint, p)
 *
 *   audit:     const batch = await client.createBatchAttestation({...})
 *              client.audit.proofUrl(recording.proofRowId)
 *              client.audit.explorerTx(result.txSignature)
 */
export class ApertureClient {
  readonly connection: Connection;
  readonly wallet: Keypair;
  readonly programs?: ProgramIds;
  readonly policy: PolicyClient;
  readonly prover: ProverClient;
  readonly compliance: ComplianceClient;
  readonly operator: OperatorAdmin;
  readonly attestation: AttestationFlow;
  readonly audit: Audit;
  readonly x402: X402Flow;
  readonly mpp: MppFlow | null;

  constructor(config: ApertureClientConfig) {
    this.wallet = config.wallet;
    this.programs = config.programs;
    this.connection =
      config.connection ??
      new Connection(
        config.rpcUrl ?? 'https://api.devnet.solana.com',
        config.connectionConfig ?? 'confirmed',
      );

    this.policy = new PolicyClient({
      baseUrl: config.policyServiceUrl,
      fetch: config.fetch,
    });
    this.prover = new ProverClient({
      baseUrl: config.proverServiceUrl,
      fetch: config.fetch,
    });
    this.compliance = new ComplianceClient({
      baseUrl: config.complianceApiUrl,
      fetch: config.fetch,
    });
    this.operator = new OperatorAdmin({
      connection: this.connection,
      wallet: this.wallet,
      policy: this.policy,
      programs: this.programs,
    });
    this.attestation = new AttestationFlow({
      connection: this.connection,
      wallet: this.wallet,
      compliance: this.compliance,
      programs: this.programs,
    });
    this.audit = new Audit({
      dashboardUrl: config.dashboardUrl,
      cluster: config.cluster ?? 'devnet',
    });

    this.x402 = new X402Flow({
      connection: this.connection,
      wallet: this.wallet,
      prover: this.prover,
      compliance: this.compliance,
      programs: this.programs,
      hookAccountsResolver: config.hookAccountsResolver,
      fetch: config.fetch,
    });

    const fetchImpl = config.fetch ?? fetch;
    const credentialsResolver =
      config.stripeCredentialsResolver ??
      createDashboardStripeCredentialsResolver(config.complianceApiUrl, fetchImpl);
    const confirmer =
      config.stripeConfirmer ??
      (config.stripeSecretKey
        ? createStripeOffSessionConfirmer(config.stripeSecretKey, fetchImpl)
        : null);

    this.mpp = confirmer
      ? new MppFlow({
          connection: this.connection,
          wallet: this.wallet,
          prover: this.prover,
          compliance: this.compliance,
          complianceApiUrl: config.complianceApiUrl,
          stripeConfirmer: confirmer,
          stripeCredentialsResolver: credentialsResolver,
          programs: this.programs,
          fetch: config.fetch,
        })
      : null;
  }

  /** Convenience: operator wallet's public key in base58. */
  get operatorId(): string {
    return this.wallet.publicKey.toBase58();
  }

  // ──────────────── onboarding shortcuts ────────────────

  /** Creates a new policy + anchors it on-chain in one call. */
  async createAndAnchorPolicy(input: PolicyInput): Promise<AnchorPolicyResult> {
    const policy = await this.policy.createPolicy(input);
    return this.operator.anchorPolicy(policy.id);
  }

  /** Updates an existing policy and re-anchors the new Merkle root. */
  async updateAndAnchorPolicy(
    policyId: string,
    update: PolicyUpdate,
  ): Promise<AnchorPolicyResult> {
    await this.policy.updatePolicy(policyId, update);
    return this.operator.anchorPolicy(policyId);
  }

  // ──────────────── runtime ────────────────

  loadActivePolicy(): Promise<LoadedPolicy> {
    return this.policy.loadActivePolicy(this.operatorId);
  }

  payX402(endpoint: string, policy: LoadedPolicy): Promise<X402PaymentResult> {
    return this.x402.pay(endpoint, policy);
  }

  payMpp(endpoint: string, policy: LoadedPolicy): Promise<MppPaymentResult> {
    if (!this.mpp) {
      throw new Error(
        'MPP is not configured — pass either stripeSecretKey or a custom stripeConfirmer to ApertureClient',
      );
    }
    return this.mpp.pay(endpoint, policy, this.operatorId);
  }

  // ──────────────── audit / batch ────────────────

  createBatchAttestation(input: {
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<BatchAttestationResult> {
    return this.attestation.createAndAnchorBatch({
      operatorId: this.operatorId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });
  }
}

export type { Policy };
