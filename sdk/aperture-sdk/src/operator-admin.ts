import {
  Connection,
  Keypair,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  buildDeactivatePolicyIx,
  buildInitializeOperatorIx,
  buildRegisterPolicyIx,
  buildUpdatePolicyIx,
} from './anchor/policy-registry-instructions.js';
import { deriveOperatorPDA, type ProgramIds } from './anchor/pda.js';
import { OnChainError, PolicyError } from './errors.js';
import { PolicyClient } from './policy.js';
import type { Policy } from './types.js';
import { hexToBytes32, sha256 } from './util/base.js';

export interface OperatorAdminOptions {
  readonly connection: Connection;
  readonly wallet: Keypair;
  readonly policy: PolicyClient;
  readonly programs?: ProgramIds;
}

export interface AnchorPolicyResult {
  readonly policyId: string;
  readonly onchainPda: string;
  readonly txSignature: string;
  readonly operation: 'register' | 'update' | 'noop';
  readonly version: number;
  readonly policy: Policy;
}

/**
 * High-level operator + policy lifecycle helper. Wraps the
 * policy_registry program's `initialize_operator`, `register_policy`,
 * `update_policy`, and `deactivate_policy` instructions and keeps the
 * policy-service's DB in sync via its `/onchain-confirmation` endpoint.
 *
 * Designed so that a third-party agent developer can onboard a brand new
 * wallet → operator + policy → on-chain anchor → ready to pay, without ever
 * touching the Aperture dashboard.
 */
export class OperatorAdmin {
  private readonly opts: OperatorAdminOptions;

  constructor(options: OperatorAdminOptions) {
    this.opts = options;
  }

  /**
   * Returns true when the operator PDA already exists on-chain. The SDK uses
   * this to decide whether to bundle an `initialize_operator` ix with the
   * next `register_policy`.
   */
  async operatorExists(): Promise<boolean> {
    const [pda] = deriveOperatorPDA(
      this.opts.wallet.publicKey,
      this.opts.programs,
    );
    const info = await this.opts.connection.getAccountInfo(pda);
    return info !== null;
  }

  /**
   * Sends `initialize_operator` to the policy-registry. Idempotent: returns
   * the existing PDA without sending a tx if the account is already there.
   */
  async initializeOperator(operatorName?: string): Promise<{
    readonly operatorPda: string;
    readonly txSignature: string | null;
  }> {
    const [pda] = deriveOperatorPDA(
      this.opts.wallet.publicKey,
      this.opts.programs,
    );
    if (await this.operatorExists()) {
      return { operatorPda: pda.toBase58(), txSignature: null };
    }
    const name =
      operatorName ??
      this.opts.wallet.publicKey.toBase58().slice(0, 32);
    const ix = buildInitializeOperatorIx(
      this.opts.wallet.publicKey,
      name,
      this.opts.programs,
    );
    const sig = await this.sendAndConfirm([ix]);
    return { operatorPda: pda.toBase58(), txSignature: sig };
  }

  /**
   * Anchors a policy on-chain end-to-end. Steps:
   *   1. GET /api/v1/policies/:id/onchain-payload to retrieve the canonical
   *      Merkle root + policy_data_hash + the operation hint (register vs
   *      update vs noop).
   *   2. If the operator PDA is missing, bundle initialize_operator.
   *   3. Build register_policy or update_policy depending on `operation`.
   *   4. Submit, confirm, and PATCH the result back to the policy-service so
   *      the DB matches the chain.
   */
  async anchorPolicy(policyId: string): Promise<AnchorPolicyResult> {
    const payload = await this.opts.policy.getOnchainPayload(policyId);

    if (payload.operation === 'noop') {
      const row = await this.opts.policy.getPolicy(policyId);
      if (!row.onchain_pda) {
        throw new PolicyError(
          `onchain-payload reports operation=noop for policy ${policyId} but the policy-service has no onchain_pda set`,
        );
      }
      return {
        policyId,
        onchainPda: row.onchain_pda,
        txSignature: '',
        operation: 'noop',
        version: row.onchain_version ?? 0,
        policy: row,
      };
    }

    const policyId32 = hexToBytes32(payload.policy_id_bytes_hex);
    const merkleRoot = hexToBytes32(payload.merkle_root_hex);
    const policyDataHash = hexToBytes32(payload.policy_data_hash_hex);

    const ixs: TransactionInstruction[] = [];
    if (!(await this.operatorExists())) {
      ixs.push(
        buildInitializeOperatorIx(
          this.opts.wallet.publicKey,
          this.opts.wallet.publicKey.toBase58().slice(0, 32),
          this.opts.programs,
        ),
      );
    }

    if (payload.operation === 'register') {
      ixs.push(
        buildRegisterPolicyIx(
          {
            authority: this.opts.wallet.publicKey,
            policyId32,
            merkleRoot,
            policyDataHash,
          },
          this.opts.programs,
        ),
      );
    } else {
      ixs.push(
        buildUpdatePolicyIx(
          {
            authority: this.opts.wallet.publicKey,
            policyId32,
            newMerkleRoot: merkleRoot,
            newPolicyDataHash: policyDataHash,
          },
          this.opts.programs,
        ),
      );
    }

    let txSig: string;
    try {
      txSig = await this.sendAndConfirm(ixs);
    } catch (err) {
      await this.opts.policy
        .confirmOnchain(policyId, {
          status: 'failed',
          error_message: err instanceof Error ? err.message : String(err),
        })
        .catch(() => undefined);
      throw err;
    }

    const [operatorPda] = deriveOperatorPDA(
      this.opts.wallet.publicKey,
      this.opts.programs,
    );
    const { derivePolicyPDA } = await import('./anchor/pda.js');
    const [policyPda] = derivePolicyPDA(operatorPda, policyId32, this.opts.programs);
    const nextVersion = (payload.onchain_version ?? 0) + 1;

    const policy = await this.opts.policy.confirmOnchain(policyId, {
      status: 'registered',
      tx_signature: txSig,
      onchain_pda: policyPda.toBase58(),
      onchain_version: nextVersion,
      merkle_root_hex: payload.merkle_root_hex,
      policy_data_hash_hex: payload.policy_data_hash_hex,
    });

    return {
      policyId,
      onchainPda: policyPda.toBase58(),
      txSignature: txSig,
      operation: payload.operation,
      version: nextVersion,
      policy,
    };
  }

  /**
   * Sends `deactivate_policy` to the policy-registry. The verifier rejects
   * any further proofs bound to this policy_data_hash.
   */
  async deactivatePolicy(policyId: string): Promise<string> {
    const payload = await this.opts.policy.getOnchainPayload(policyId);
    const policyId32 = hexToBytes32(payload.policy_id_bytes_hex);
    const ix = buildDeactivatePolicyIx(
      this.opts.wallet.publicKey,
      policyId32,
      this.opts.programs,
    );
    return this.sendAndConfirm([ix]);
  }

  private async sendAndConfirm(
    ixs: readonly TransactionInstruction[],
  ): Promise<string> {
    const tx = new Transaction();
    for (const ix of ixs) tx.add(ix);
    tx.feePayer = this.opts.wallet.publicKey;
    const { blockhash } = await this.opts.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(this.opts.wallet);
    try {
      const sig = await this.opts.connection.sendRawTransaction(tx.serialize());
      await this.opts.connection.confirmTransaction(sig, 'confirmed');
      return sig;
    } catch (err) {
      throw new OnChainError(
        `policy-registry transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}

// Helper so the SHA-256 hash of a policy UUID can be computed client-side
// (e.g. for PDA derivation outside of OperatorAdmin). The policy-service
// returns the same value as `policy_id_bytes_hex` on the onchain-payload
// endpoint; this convenience matches it byte-for-byte.
export function policyIdToBytes(policyId: string): Uint8Array {
  return sha256(policyId);
}
