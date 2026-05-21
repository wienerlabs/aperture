import {
  Connection,
  Keypair,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { buildVerifyBatchAttestationIx } from './anchor/batch-attestation.js';
import type { ProgramIds } from './anchor/pda.js';
import { ComplianceClient } from './compliance.js';
import { OnChainError } from './errors.js';
import type { BatchAttestationSummary } from './types.js';
import { hexToBytes32, sha256 } from './util/base.js';

export interface AttestationFlowOptions {
  readonly connection: Connection;
  readonly wallet: Keypair;
  readonly compliance: ComplianceClient;
  readonly programs?: ProgramIds;
}

export interface BatchAttestationResult {
  readonly attestationId: string;
  readonly txSignature: string;
  readonly batchProofHash: string;
  readonly totalPayments: number;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly summary: BatchAttestationSummary;
}

/**
 * Creates a periodic batch attestation that aggregates every ProofRecord the
 * compliance-api has for an operator within a window, then anchors the
 * aggregated Merkle hash on-chain via the verifier program's
 * `verify_batch_attestation` instruction.
 *
 * The on-chain AttestationRecord PDA's seeds include the batch hash, so two
 * batches with the same content / window produce the same PDA and the
 * Anchor `init` constraint makes the second submit fail — the SDK surfaces
 * that as `OnChainError`. Callers should pick non-overlapping windows.
 */
export class AttestationFlow {
  private readonly opts: AttestationFlowOptions;

  constructor(options: AttestationFlowOptions) {
    this.opts = options;
  }

  async createAndAnchorBatch(input: {
    readonly operatorId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<BatchAttestationResult> {
    const summary = await this.opts.compliance.createBatch({
      operatorId: input.operatorId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    });

    const batchHashBytes = hexToBytes32(summary.proof_hash);
    const periodStartUnix = BigInt(Math.floor(input.periodStart.getTime() / 1000));
    const periodEndUnix = BigInt(Math.floor(input.periodEnd.getTime() / 1000));
    const batchHashHex = summary.proof_hash.startsWith('0x')
      ? summary.proof_hash.slice(2)
      : summary.proof_hash;
    const digestInput = `batch:${batchHashHex}:${summary.total_payments}:${periodStartUnix}:${periodEndUnix}`;
    const receiptBytes = new TextEncoder().encode(digestInput);
    const journalDigest = sha256(receiptBytes);

    const ix = buildVerifyBatchAttestationIx(
      {
        operator: this.opts.wallet.publicKey,
        payer: this.opts.wallet.publicKey,
        batchHash: batchHashBytes,
        journalDigest,
        totalPayments: summary.total_payments,
        periodStartUnix,
        periodEndUnix,
        receiptData: receiptBytes,
      },
      this.opts.programs,
    );

    const txSig = await this.sendAndConfirm([ix]);
    await this.opts.compliance
      .attachAttestationTxSignature(summary.id, txSig)
      .catch(() => undefined);

    return {
      attestationId: summary.id,
      txSignature: txSig,
      batchProofHash: summary.proof_hash,
      totalPayments: summary.total_payments,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      summary,
    };
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
        `verify_batch_attestation submission failed: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
  }
}
