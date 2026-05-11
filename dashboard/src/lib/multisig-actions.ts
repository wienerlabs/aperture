'use client';

/**
 * Browser-side Squads V4 multisig actions. Mirrors the propose / approve /
 * execute primitives from scripts/squads-cli.ts but signs and sends every
 * transaction through the wallet adapter so the operator's keypair never
 * leaves Phantom.
 *
 * Three primitives:
 *   - proposePolicyAnchor: builds vaultTransactionCreate + proposalCreate for
 *     register_policy_multisig or update_policy_multisig
 *   - approveProposal: builds proposalApprove
 *   - executeProposal: builds vaultTransactionExecute (V0 with lookup tables)
 *
 * Plus an autoAnchorPolicy convenience that chains all three for 1-of-1
 * multisigs where the connected wallet is the only member. For N-of-M, the
 * caller wires propose + approve + execute to separate UI actions because
 * each requires a different member's signature.
 *
 * Every primitive returns the on-chain signature plus enough context for
 * the caller to write the policy-service mirror (proposal record id /
 * status update) so the dashboard cache stays in sync with chain state.
 */

import * as multisig from '@sqds/multisig';
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import {
  buildRegisterPolicyMultisigIx,
  buildUpdatePolicyMultisigIx,
} from './anchor-instructions';
import { multisigApi } from './api';
import { config } from './config';

export interface MultisigSnapshot {
  readonly threshold: number;
  readonly memberCount: number;
  readonly nextTransactionIndex: bigint;
  readonly vaultPda: PublicKey;
}

export interface ProposePolicyParams {
  readonly action: 'register' | 'update';
  readonly multisigAddress: string;
  readonly vaultIndex: number;
  /** Required for register; ignored for update. 32-byte hex policy id. */
  readonly policyIdBytesHex?: string;
  /** Required for update; ignored for register. Existing policy PDA. */
  readonly policyPda?: string;
  readonly merkleRootHex: string;
  readonly policyDataHashHex: string;
  /** Optional UUID for the policy-service mirror. */
  readonly policyUuid?: string;
  /** Free-form memo persisted on the Squads transaction. */
  readonly memo?: string;
}

export interface ProposeResult {
  readonly transactionIndex: bigint;
  readonly transactionPda: PublicKey;
  readonly proposalPda: PublicKey;
  readonly policyPda: PublicKey;
  readonly signature: string;
  readonly proposalRecordId: string | null;
}

export interface ApproveResult {
  readonly signature: string;
  readonly approvalCount: number;
  readonly rejectionCount: number;
  readonly status: 'pending' | 'approved';
}

export interface ExecuteResult {
  readonly signature: string;
}

export interface AutoAnchorResult {
  readonly proposeSignature: string;
  readonly approveSignature: string;
  readonly executeSignature: string;
  readonly transactionIndex: bigint;
  readonly transactionPda: PublicKey;
  readonly proposalPda: PublicKey;
  readonly policyPda: PublicKey;
  readonly proposalRecordId: string | null;
}

interface WalletSigner {
  readonly publicKey: PublicKey;
  readonly sendTransaction: WalletContextState['sendTransaction'];
}

function assertWalletReady(
  wallet: WalletContextState,
): asserts wallet is WalletContextState & WalletSigner {
  if (!wallet.publicKey) {
    throw new Error('Wallet not connected');
  }
  if (!wallet.sendTransaction) {
    throw new Error('Wallet adapter does not expose sendTransaction');
  }
}

async function readMultisig(
  conn: Connection,
  multisigPda: PublicKey,
): Promise<MultisigSnapshot> {
  const account = await multisig.accounts.Multisig.fromAccountAddress(
    conn,
    multisigPda,
  );
  // The Squads SDK exposes transactionIndex as a BN, which BigInt() can
  // consume directly because BN exposes a toString().
  const nextTransactionIndex =
    BigInt(account.transactionIndex.toString()) + BigInt(1);
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: 0,
  });
  return {
    threshold: account.threshold,
    memberCount: account.members.length,
    nextTransactionIndex,
    vaultPda,
  };
}

async function sendLegacyIxs(
  conn: Connection,
  wallet: WalletContextState,
  instructions: TransactionInstruction[],
): Promise<string> {
  assertWalletReady(wallet);
  const latest = await conn.getLatestBlockhash('confirmed');
  // We use a versioned transaction even for "legacy"-style instruction
  // lists so the wallet adapter applies a consistent signing path. No
  // address lookup tables here; the V0 path is used in executeProposal
  // where Squads ships them.
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const sig = await wallet.sendTransaction(tx, conn);
  await conn.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  );
  return sig;
}

/**
 * Step 1 of the multisig anchor flow: create the vault transaction +
 * proposal that wraps register_policy_multisig or update_policy_multisig.
 * The wallet pays for the rent and signs as the proposing member.
 */
export async function proposePolicyAnchor(
  conn: Connection,
  wallet: WalletContextState,
  params: ProposePolicyParams,
): Promise<ProposeResult> {
  assertWalletReady(wallet);
  const multisigPda = new PublicKey(params.multisigAddress);
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: params.vaultIndex,
  });
  const snap = await readMultisig(conn, multisigPda);
  const newTxIndex = snap.nextTransactionIndex;

  let policyIx: TransactionInstruction;
  let policyPda: PublicKey;

  if (params.action === 'register') {
    if (!params.policyIdBytesHex) {
      throw new Error('policyIdBytesHex is required for register');
    }
    const built = buildRegisterPolicyMultisigIx(wallet.publicKey, {
      squadsMultisig: multisigPda,
      multisigSigner: vaultPda,
      vaultIndex: params.vaultIndex,
      payer: vaultPda,
      policyIdBytesHex: params.policyIdBytesHex,
      merkleRootHex: params.merkleRootHex,
      policyDataHashHex: params.policyDataHashHex,
    });
    policyIx = built.instruction;
    policyPda = built.policyPDA;
  } else {
    if (!params.policyPda) {
      throw new Error('policyPda is required for update');
    }
    policyPda = new PublicKey(params.policyPda);
    policyIx = buildUpdatePolicyMultisigIx(wallet.publicKey, {
      squadsMultisig: multisigPda,
      multisigSigner: vaultPda,
      vaultIndex: params.vaultIndex,
      policyPDA: policyPda,
      merkleRootHex: params.merkleRootHex,
      policyDataHashHex: params.policyDataHashHex,
    });
  }

  // Squads wraps the policy ix inside a vault transaction that the multisig
  // ratifies before executing. The inner message references the vault PDA as
  // payer because once executed it's the vault that pays for any rent the
  // CPI'd policy ix needs.
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const innerMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: [policyIx],
  });

  const vaultTxIx = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: newTxIndex,
    creator: wallet.publicKey,
    vaultIndex: params.vaultIndex,
    ephemeralSigners: 0,
    transactionMessage: innerMessage,
    memo: params.memo ?? `${params.action}_policy via dashboard`,
  });
  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex: newTxIndex,
    creator: wallet.publicKey,
  });

  // The vault PDA is the inner-CPI payer for register_policy_multisig and
  // therefore needs lamports to cover the policy_account rent (~0.0014 SOL
  // for a 168-byte account on devnet). Squads vaults are created with zero
  // balance and the binding flow funds the operator wallet but not the
  // vault, so the first multisig anchor would otherwise fail at execute
  // simulation with a generic Phantom "Unexpected error". We top up to a
  // safe headroom from the connected wallet inside the same outer tx so
  // the user does not see an extra signature prompt.
  const VAULT_MIN_LAMPORTS = Math.floor(0.05 * LAMPORTS_PER_SOL);
  const vaultBalance = await conn.getBalance(vaultPda, 'confirmed');
  const fundingIxs: TransactionInstruction[] =
    vaultBalance < VAULT_MIN_LAMPORTS
      ? [
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: vaultPda,
            lamports: VAULT_MIN_LAMPORTS - vaultBalance,
          }),
        ]
      : [];

  const signature = await sendLegacyIxs(conn, wallet, [
    ...fundingIxs,
    vaultTxIx,
    proposalIx,
  ]);

  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: newTxIndex,
  });
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: newTxIndex,
  });

  // Mirror to policy-service so the dashboard sees the new proposal in the
  // pending list. Failure to mirror does not invalidate the on-chain
  // proposal; we surface a warning but keep the success path.
  let proposalRecordId: string | null = null;
  try {
    const recorded = await multisigApi.recordProposal({
      operator_id: wallet.publicKey.toBase58(),
      multisig_address: multisigPda.toBase58(),
      transaction_index: Number(newTxIndex),
      transaction_pda: transactionPda.toBase58(),
      proposal_pda: proposalPda.toBase58(),
      action:
        params.action === 'register' ? 'register_policy' : 'update_policy',
      policy_id: params.policyUuid,
      target_merkle_root: params.merkleRootHex,
      target_policy_hash: params.policyDataHashHex,
      created_by: wallet.publicKey.toBase58(),
    });
    proposalRecordId = recorded.data?.id ?? null;
  } catch (err) {
    // Mirror-only failure; chain state is fine.
    console.warn('Mirror recordProposal failed; continuing:', err);
  }

  return {
    transactionIndex: newTxIndex,
    transactionPda,
    proposalPda,
    policyPda,
    signature,
    proposalRecordId,
  };
}

/**
 * Step 2: have a multisig member approve the proposal. Returns the new
 * approval count plus a derived status; once approvalCount >= threshold
 * the proposal is ready to execute.
 */
export async function approveProposal(
  conn: Connection,
  wallet: WalletContextState,
  params: {
    readonly multisigAddress: string;
    readonly transactionIndex: bigint | number;
    readonly threshold: number;
    readonly proposalRecordId?: string | null;
  },
): Promise<ApproveResult> {
  assertWalletReady(wallet);
  const multisigPda = new PublicKey(params.multisigAddress);
  const txIndex = BigInt(params.transactionIndex);

  const ix = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex: txIndex,
    member: wallet.publicKey,
  });
  const signature = await sendLegacyIxs(conn, wallet, [ix]);

  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: txIndex,
  });
  const proposal = await multisig.accounts.Proposal.fromAccountAddress(
    conn,
    proposalPda,
  );
  const approvalCount = proposal.approved.length;
  const rejectionCount = proposal.rejected.length;
  const status: ApproveResult['status'] =
    approvalCount >= params.threshold ? 'approved' : 'pending';

  if (params.proposalRecordId) {
    try {
      await multisigApi.updateProposalStatus(params.proposalRecordId, {
        status,
        approval_count: approvalCount,
        rejection_count: rejectionCount,
      });
    } catch (err) {
      console.warn('Mirror updateProposalStatus failed; continuing:', err);
    }
  }

  return { signature, approvalCount, rejectionCount, status };
}

/**
 * Step 3: any member with execute permission can call this once the
 * proposal is approved. The Squads SDK builds a V0 transaction with the
 * lookup tables it needs (the actual policy CPI lives inside the vault
 * transaction message we created in step 1).
 */
export async function executeProposal(
  conn: Connection,
  wallet: WalletContextState,
  params: {
    readonly multisigAddress: string;
    readonly transactionIndex: bigint | number;
    readonly proposalRecordId?: string | null;
  },
): Promise<ExecuteResult> {
  assertWalletReady(wallet);
  const multisigPda = new PublicKey(params.multisigAddress);
  const txIndex = BigInt(params.transactionIndex);

  const { instruction, lookupTableAccounts } =
    await multisig.instructions.vaultTransactionExecute({
      connection: conn,
      multisigPda,
      transactionIndex: txIndex,
      member: wallet.publicKey,
    });

  const latest = await conn.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [instruction],
  }).compileToV0Message(lookupTableAccounts);
  const tx = new VersionedTransaction(message);
  const signature = await wallet.sendTransaction(tx, conn);
  await conn.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  );

  if (params.proposalRecordId) {
    try {
      await multisigApi.updateProposalStatus(params.proposalRecordId, {
        status: 'executed',
        executed_tx: signature,
      });
    } catch (err) {
      console.warn('Mirror updateProposalStatus(executed) failed:', err);
    }
  }

  return { signature };
}

/**
 * One-shot helper for 1-of-1 multisigs (or any multisig where the connected
 * wallet alone meets the threshold AND has execute permission). Wraps
 * propose -> approve -> execute with a single status callback so the UI
 * can surface progress without re-implementing the choreography.
 */
export async function autoAnchorPolicy(
  conn: Connection,
  wallet: WalletContextState,
  params: ProposePolicyParams & { readonly threshold: number },
  onStatus?: (
    step: 'propose' | 'approve' | 'execute' | 'mirror',
    detail?: string,
  ) => void,
): Promise<AutoAnchorResult> {
  onStatus?.('propose', 'Creating vault transaction + proposal');
  const proposed = await proposePolicyAnchor(conn, wallet, params);

  onStatus?.('approve', 'Casting approval signature');
  const approved = await approveProposal(conn, wallet, {
    multisigAddress: params.multisigAddress,
    transactionIndex: proposed.transactionIndex,
    threshold: params.threshold,
    proposalRecordId: proposed.proposalRecordId,
  });
  if (approved.status !== 'approved') {
    // For an N-of-M multisig the connected wallet has approved but the
    // threshold isn't met yet. The caller is responsible for surfacing the
    // remaining approvals UI; we return early without executing so we
    // don't try to execute a still-pending proposal.
    throw new Error(
      `Proposal needs ${params.threshold} approval(s) but only ${approved.approvalCount} so far. ` +
        'Other members must approve before executing.',
    );
  }

  onStatus?.('execute', 'Executing the vault transaction');
  const executed = await executeProposal(conn, wallet, {
    multisigAddress: params.multisigAddress,
    transactionIndex: proposed.transactionIndex,
    proposalRecordId: proposed.proposalRecordId,
  });

  onStatus?.('mirror', 'Done');
  return {
    proposeSignature: proposed.signature,
    approveSignature: approved.signature,
    executeSignature: executed.signature,
    transactionIndex: proposed.transactionIndex,
    transactionPda: proposed.transactionPda,
    proposalPda: proposed.proposalPda,
    policyPda: proposed.policyPda,
    proposalRecordId: proposed.proposalRecordId,
  };
}

/** Network the dashboard talks to; surfaced for UI labels. */
export function isMultisigOnDevnet(): boolean {
  return (config.solanaNetwork ?? 'devnet').toLowerCase() === 'devnet';
}
