/**
 * Helpers for building audit URLs and Solana Explorer links.
 *
 * The Aperture dashboard renders per-record audit pages at /audit/<id> where
 * the id is either a ProofRecord row UUID (from compliance-api
 * `POST /api/v1/proofs`) or a batch attestation UUID (from
 * `POST /api/v1/attestations/batch`).
 *
 * If you pass `dashboardUrl` to the `ApertureClient`, `proofUrl` and
 * `attestationUrl` return shareable links against your hosted dashboard.
 * If you do not, both return `null`. Solana Explorer transaction URLs work
 * unconditionally via `explorerTx`.
 */

export interface AuditUrlConfig {
  /** Optional base URL of an Aperture dashboard. No trailing slash. */
  readonly dashboardUrl?: string;
  /** Solana cluster slug for explorer links. */
  readonly cluster?: 'devnet' | 'mainnet-beta' | 'testnet' | 'custom';
  /** Custom RPC for the explorer when `cluster='custom'`. */
  readonly customRpc?: string;
}

export class Audit {
  private readonly dashboardBase: string | null;
  private readonly clusterQuery: string;

  constructor(config: AuditUrlConfig) {
    this.dashboardBase = config.dashboardUrl
      ? config.dashboardUrl.replace(/\/$/, '')
      : null;
    const cluster = config.cluster ?? 'devnet';
    if (cluster === 'mainnet-beta') {
      this.clusterQuery = '';
    } else if (cluster === 'custom' && config.customRpc) {
      this.clusterQuery = `?cluster=custom&customUrl=${encodeURIComponent(config.customRpc)}`;
    } else {
      this.clusterQuery = `?cluster=${cluster}`;
    }
  }

  /**
   * Audit URL for a ProofRecord row (compliance-api proof_id). Returns null
   * when no dashboard URL was supplied to the SDK.
   */
  proofUrl(proofRowId: string): string | null {
    if (!this.dashboardBase) return null;
    return `${this.dashboardBase}/audit/${proofRowId}`;
  }

  /**
   * Audit URL for a batch attestation row. Returns null when no dashboard
   * URL was supplied to the SDK.
   */
  attestationUrl(attestationId: string): string | null {
    if (!this.dashboardBase) return null;
    return `${this.dashboardBase}/audit/${attestationId}`;
  }

  /** Solana Explorer link for a transaction signature. */
  explorerTx(txSignature: string): string {
    return `https://explorer.solana.com/tx/${txSignature}${this.clusterQuery}`;
  }

  /** Solana Explorer link for an account or PDA. */
  explorerAccount(address: string): string {
    return `https://explorer.solana.com/address/${address}${this.clusterQuery}`;
  }
}
