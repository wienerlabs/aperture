import { Router } from 'express';
import { z } from 'zod';
import type {
  ApiResponse,
  MultisigBinding,
  MultisigOnchainSnapshot,
  MultisigAuditEntry,
  MultisigProposal,
  MultisigProposalStatus,
} from '@aperture/types';
import { validateBody } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';
import {
  fetchMultisigSnapshot,
  deriveVaultPda,
  SQUADS_V4_PROGRAM_ID,
} from '../utils/squads-fetcher.js';
import {
  createAndBindMultisig,
  SquadsBinderError,
} from '../utils/squads-binder.js';
import {
  upsertBinding,
  syncSnapshot,
  getBinding,
  deleteBinding,
  listAudit,
} from '../models/operator-multisig.js';
import {
  createProposal,
  listProposalsForOperator,
  getProposal,
  updateProposalStatus,
  listPendingForPolicy,
} from '../models/multisig-proposals.js';
import { PublicKey } from '@solana/web3.js';

const router = Router();

const Base58Schema = z
  .string()
  .min(32)
  .max(44)
  .refine((s) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(s), {
    message: 'Must be a base58 encoded address',
  });

const SignatureSchema = z
  .string()
  .min(32)
  .max(128)
  .refine((s) => /^[1-9A-HJ-NP-Za-km-z]+$/.test(s), {
    message: 'Must be a base58 encoded transaction signature',
  });

const VaultIndexSchema = z.number().int().min(0).max(255);

const BindBindingSchema = z.object({
  operator_id: z.string().min(1).max(64),
  multisig_address: Base58Schema,
  vault_index: VaultIndexSchema.default(0),
  label: z.string().min(1).max(255).optional(),
  bind_tx_signature: SignatureSchema.optional(),
  actor: Base58Schema,
});

const LookupSchema = z.object({
  multisig_address: Base58Schema,
  vault_index: VaultIndexSchema.default(0),
});

const SyncSchema = z.object({
  actor: Base58Schema,
});

const DeleteSchema = z.object({
  actor: Base58Schema,
});

interface BindingResponseBody {
  readonly binding: MultisigBinding;
  readonly snapshot: MultisigOnchainSnapshot;
}

/**
 * GET /api/v1/squads/lookup
 *   query: ?multisig_address=...&vault_index=0
 *
 * Pure read of an on-chain Squads multisig + derived vault PDA. The
 * dashboard uses this for the "preview before bind" step so the operator
 * can confirm threshold + members before signing the on-chain set_multisig
 * instruction.
 */
router.get('/lookup', async (req, res, next) => {
  try {
    const parsed = LookupSchema.safeParse({
      multisig_address: req.query.multisig_address,
      vault_index: req.query.vault_index ? Number(req.query.vault_index) : undefined,
    });
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map((i) => i.message).join('; '));
    }

    const snapshot = await fetchMultisigSnapshot(
      parsed.data.multisig_address,
      parsed.data.vault_index,
    );

    const response: ApiResponse<MultisigOnchainSnapshot> = {
      success: true,
      data: snapshot,
      error: null,
    };

    res.json(response);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    if (error instanceof Error) {
      // The fetcher annotates errors with a `kind` so the route can
      // distinguish "address not on chain" (404) from "address exists
      // but isn't a Squads multisig" (422 — semantic mismatch, not a
      // routing problem) from "address didn't even parse" (400).
      const annotated = error as Error & {
        kind?: string;
        ownerProgram?: string;
        ownerLabel?: string;
      };
      if (annotated.kind === 'invalid_address') {
        return next(new AppError(400, error.message));
      }
      if (annotated.kind === 'wrong_owner') {
        // Surface owner program + label as `details` so the dashboard
        // can render "this looks like a wallet" guidance without
        // re-running RPC.
        const details: string[] = [];
        if (annotated.ownerProgram) details.push(`owner=${annotated.ownerProgram}`);
        if (annotated.ownerLabel) details.push(`label=${annotated.ownerLabel}`);
        return next(new AppError(422, error.message, details.length ? details : undefined));
      }
      return next(new AppError(404, error.message));
    }
    next(error);
  }
});

/**
 * POST /api/v1/squads/binding
 *
 * Cache a multisig binding for an operator. The on-chain set_multisig
 * instruction must already have been signed and confirmed by the wallet
 * client; this endpoint only mirrors the result into the off-chain ledger
 * after re-fetching the multisig from RPC to make sure the threshold +
 * members are accurate at the time of binding.
 */
router.post('/binding', validateBody(BindBindingSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof BindBindingSchema>;

    const snapshot = await fetchMultisigSnapshot(body.multisig_address, body.vault_index);

    const binding = await upsertBinding({
      operatorId: body.operator_id,
      multisigAddress: snapshot.multisigAddress,
      vaultIndex: body.vault_index,
      vaultPda: snapshot.vaultPda,
      threshold: snapshot.threshold,
      memberCount: snapshot.members.length,
      members: snapshot.members,
      label: body.label,
      bindTxSignature: body.bind_tx_signature,
      actor: body.actor,
    });

    logger.info('Multisig binding created', {
      operatorId: body.operator_id,
      multisigAddress: snapshot.multisigAddress,
      vaultIndex: body.vault_index,
      threshold: snapshot.threshold,
      memberCount: snapshot.members.length,
    });

    const response: ApiResponse<BindingResponseBody> = {
      success: true,
      data: { binding, snapshot },
      error: null,
    };

    res.status(201).json(response);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    if (error instanceof Error) {
      logger.warn('Multisig binding failed', { error: error.message });
      return next(new AppError(422, error.message));
    }
    next(error);
  }
});

const AutomatedBindSchema = z.object({
  threshold: z.number().int().min(1).max(10).optional(),
  extra_members: z.array(Base58Schema).max(9).optional(),
  label: z.string().min(1).max(255).optional(),
  vault_index: VaultIndexSchema.optional(),
});

interface AutomatedBindResponseBody {
  readonly binding: MultisigBinding;
  readonly keypairBytes: readonly number[];
  readonly signatures: { readonly create: string; readonly bind: string };
}

/**
 * POST /api/v1/squads/bind/automated
 *
 * Devnet-only convenience: server generates a fresh operator keypair,
 * funds it from the faucet, calls multisigCreateV2 + initialise_operator
 * + set_multisig, then mirrors the binding into Postgres. Response
 * includes the keypair bytes ONCE so the operator can persist them
 * locally — there is no server-side custody. Mainnet rejects this with
 * 403 because secret material should never be generated where it might
 * hold real value.
 */
router.post(
  '/bind/automated',
  validateBody(AutomatedBindSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof AutomatedBindSchema>;

      const result = await createAndBindMultisig({
        threshold: body.threshold,
        extraMembers: body.extra_members,
        label: body.label,
        vaultIndex: body.vault_index,
      });

      const binding = await upsertBinding({
        operatorId: result.operatorAuthority,
        multisigAddress: result.multisigAddress,
        vaultIndex: result.vaultIndex,
        vaultPda: result.vaultPda,
        threshold: result.threshold,
        memberCount: result.members.length,
        members: result.members.map((m) => ({
          key: m.key,
          permissionsMask: m.permissionsMask,
        })),
        label: body.label,
        bindTxSignature: result.signatures.bind,
        actor: result.operatorAuthority,
      });

      logger.info('Automated multisig bind complete', {
        operatorId: result.operatorAuthority,
        multisigAddress: result.multisigAddress,
        vaultPda: result.vaultPda,
        threshold: result.threshold,
        memberCount: result.members.length,
      });

      const response: ApiResponse<AutomatedBindResponseBody> = {
        success: true,
        data: {
          binding,
          keypairBytes: result.keypairBytes,
          signatures: result.signatures,
        },
        error: null,
      };
      res.status(201).json(response);
    } catch (error) {
      if (error instanceof SquadsBinderError) {
        const statusByKind: Record<typeof error.kind, number> = {
          forbidden: 403,
          airdrop_failed: 503,
          treasury_unavailable: 503,
          treasury_underfunded: 503,
          invalid_threshold: 400,
          invalid_member: 400,
          multisig_create_failed: 502,
          aperture_bind_failed: 502,
        };
        return next(new AppError(statusByKind[error.kind], error.message));
      }
      next(error);
    }
  },
);

/**
 * GET /api/v1/squads/binding/:operatorId
 *
 * Returns the cached binding for an operator. 404 when the operator hasn't
 * bound a multisig yet — the dashboard treats this as the unbound state.
 */
router.get('/binding/:operatorId', async (req, res, next) => {
  try {
    const operatorId = String(req.params.operatorId);
    if (!operatorId || operatorId.length > 64) {
      throw new AppError(400, 'operatorId must be a non-empty string up to 64 chars');
    }

    const binding = await getBinding(operatorId);
    if (!binding) {
      throw new AppError(404, 'No multisig binding for operator');
    }

    const response: ApiResponse<MultisigBinding> = {
      success: true,
      data: binding,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/squads/binding/:operatorId/sync
 *
 * Re-fetch the on-chain multisig and refresh the cached threshold +
 * members. Useful when the operator added/removed signers in the Squads
 * UI and the dashboard view is stale.
 */
router.post(
  '/binding/:operatorId/sync',
  validateBody(SyncSchema),
  async (req, res, next) => {
    try {
      const operatorId = String(req.params.operatorId);
      const { actor } = req.body as z.infer<typeof SyncSchema>;

      const existing = await getBinding(operatorId);
      if (!existing) {
        throw new AppError(404, 'No multisig binding for operator');
      }

      const snapshot = await fetchMultisigSnapshot(
        existing.multisigAddress,
        existing.vaultIndex,
      );

      const binding = await syncSnapshot({
        operatorId,
        multisigAddress: snapshot.multisigAddress,
        vaultIndex: existing.vaultIndex,
        vaultPda: snapshot.vaultPda,
        threshold: snapshot.threshold,
        members: snapshot.members,
        actor,
      });

      const response: ApiResponse<BindingResponseBody> = {
        success: true,
        data: { binding, snapshot },
        error: null,
      };
      res.json(response);
    } catch (error) {
      if (error instanceof AppError) return next(error);
      if (error instanceof Error) return next(new AppError(422, error.message));
      next(error);
    }
  },
);

/**
 * DELETE /api/v1/squads/binding/:operatorId
 *
 * Remove the off-chain cache. Note that this does NOT clear the on-chain
 * OperatorAccount.multisig field — that requires a separate set_multisig
 * call with vault_index pointing at a freshly derived no-op vault. Future
 * work: expose a "rotate" endpoint that orchestrates both at once.
 */
router.delete(
  '/binding/:operatorId',
  validateBody(DeleteSchema),
  async (req, res, next) => {
    try {
      const operatorId = String(req.params.operatorId);
      const { actor } = req.body as z.infer<typeof DeleteSchema>;

      const removed = await deleteBinding(operatorId, actor);
      if (!removed) {
        throw new AppError(404, 'No multisig binding for operator');
      }

      const response: ApiResponse<{ removed: boolean; multisigAddress: string }> = {
        success: true,
        data: { removed: true, multisigAddress: removed.multisigAddress },
        error: null,
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/squads/audit/:operatorId
 *
 * Full audit history (bind / unbind / sync / rotate) for an operator's
 * multisig binding. Append-only.
 */
router.get('/audit/:operatorId', async (req, res, next) => {
  try {
    const operatorId = String(req.params.operatorId);
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const entries = await listAudit(operatorId, limit);
    const response: ApiResponse<readonly MultisigAuditEntry[]> = {
      success: true,
      data: entries,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/squads/program
 *
 * Static metadata about the Squads V4 program — useful for the dashboard
 * to render the program ID + a deterministic vault PDA preview without
 * hitting RPC.
 */
router.get('/program', (_req, res) => {
  const response: ApiResponse<{
    programId: string;
    vaultPdaPreview: (multisigAddress: string, vaultIndex: number) => string;
  } & {
    programId: string;
    docsUrl: string;
  }> = {
    success: true,
    data: {
      programId: SQUADS_V4_PROGRAM_ID.toBase58(),
      docsUrl: 'https://docs.squads.so/main/development/squads-program',
      vaultPdaPreview: () => '',
    } as never,
    error: null,
  };

  res.json({
    success: true,
    data: {
      programId: SQUADS_V4_PROGRAM_ID.toBase58(),
      docsUrl: 'https://docs.squads.so/main/development/squads-program',
    },
    error: null,
  });
  void response;
});

/**
 * GET /api/v1/squads/derive-vault
 *   query: ?multisig_address=...&vault_index=0
 *
 * Returns the deterministic vault PDA for a given multisig + vault index.
 * Lets the dashboard preview the vault address before the operator
 * commits to a binding.
 */
router.get('/derive-vault', (req, res, next) => {
  try {
    const parsed = LookupSchema.safeParse({
      multisig_address: req.query.multisig_address,
      vault_index: req.query.vault_index ? Number(req.query.vault_index) : undefined,
    });
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues.map((i) => i.message).join('; '));
    }

    const multisigPubkey = new PublicKey(parsed.data.multisig_address);
    const vaultPda = deriveVaultPda(multisigPubkey, parsed.data.vault_index);

    res.json({
      success: true,
      data: {
        multisigAddress: parsed.data.multisig_address,
        vaultIndex: parsed.data.vault_index,
        vaultPda: vaultPda.toBase58(),
        squadsProgramId: SQUADS_V4_PROGRAM_ID.toBase58(),
      },
      error: null,
    });
  } catch (error) {
    next(error);
  }
});

// =========================================================================
// Multisig proposals
// =========================================================================
//
// Aperture indexes multisig proposals so the dashboard can show "this
// policy update is awaiting multisig approval" without re-deriving Squads
// state on every paint. Squads remains the canonical source of truth —
// these endpoints are the off-chain mirror.

const ProposalActionSchema = z.enum([
  'register_policy',
  'update_policy',
  'deactivate_policy',
  'rotate_multisig',
  'custom',
]);

const ProposalStatusSchema = z.enum([
  'pending',
  'approved',
  'executed',
  'rejected',
  'cancelled',
  'expired',
]);

const RecordProposalSchema = z.object({
  operator_id: z.string().min(1).max(64),
  multisig_address: Base58Schema,
  transaction_index: z.number().int().nonnegative(),
  transaction_pda: Base58Schema,
  proposal_pda: Base58Schema.optional(),
  action: ProposalActionSchema,
  policy_id: z.string().uuid().optional(),
  target_merkle_root: z.string().length(64).optional(),
  target_policy_hash: z.string().length(64).optional(),
  created_by: Base58Schema,
});

const ProposalStatusUpdateSchema = z.object({
  status: ProposalStatusSchema,
  approval_count: z.number().int().nonnegative().optional(),
  rejection_count: z.number().int().nonnegative().optional(),
  executed_tx: SignatureSchema.optional(),
});

/**
 * POST /api/v1/squads/proposal
 *
 * Record a Squads transaction proposal in the off-chain index. The
 * dashboard creates Squads transactions client-side via @sqds/multisig
 * and calls this endpoint right after the proposal is announced on-chain
 * so the policies grid can show "Awaiting multisig approval" pills.
 */
router.post('/proposal', validateBody(RecordProposalSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof RecordProposalSchema>;

    const proposal = await createProposal({
      operatorId: body.operator_id,
      multisigAddress: body.multisig_address,
      transactionIndex: body.transaction_index,
      transactionPda: body.transaction_pda,
      proposalPda: body.proposal_pda,
      action: body.action,
      policyId: body.policy_id,
      targetMerkleRoot: body.target_merkle_root,
      targetPolicyHash: body.target_policy_hash,
      createdBy: body.created_by,
    });

    logger.info('Multisig proposal recorded', {
      operatorId: body.operator_id,
      proposalId: proposal.id,
      action: proposal.action,
      multisigAddress: proposal.multisigAddress,
      transactionIndex: proposal.transactionIndex,
    });

    const response: ApiResponse<MultisigProposal> = {
      success: true,
      data: proposal,
      error: null,
    };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/squads/proposals/operator/:operatorId
 *   query: ?status=pending|approved|executed|rejected|cancelled|expired|all
 *   query: ?limit=N (default 50, max 200)
 *
 * List proposals for an operator. The dashboard renders pending +
 * approved by default in the Multisig tab; the policies grid filters
 * further to the proposals attached to a specific policy.
 */
router.get('/proposals/operator/:operatorId', async (req, res, next) => {
  try {
    const operatorId = String(req.params.operatorId);
    if (!operatorId || operatorId.length > 64) {
      throw new AppError(400, 'operatorId must be a non-empty string up to 64 chars');
    }
    const status = req.query.status as MultisigProposalStatus | 'all' | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const proposals = await listProposalsForOperator(operatorId, { status, limit });
    const response: ApiResponse<readonly MultisigProposal[]> = {
      success: true,
      data: proposals,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/squads/proposals/policy/:policyId
 *
 * List pending+approved proposals tied to a single policy. Used by the
 * PoliciesTab pending pill so the operator can see at a glance which
 * policies are mid-rotation through the multisig.
 */
router.get('/proposals/policy/:policyId', async (req, res, next) => {
  try {
    const policyId = String(req.params.policyId);
    if (!policyId) throw new AppError(400, 'policyId is required');
    const proposals = await listPendingForPolicy(policyId);
    const response: ApiResponse<readonly MultisigProposal[]> = {
      success: true,
      data: proposals,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/squads/proposal/:id
 *
 * Single proposal lookup, used by the proposal detail panel.
 */
router.get('/proposal/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const proposal = await getProposal(id);
    if (!proposal) throw new AppError(404, 'Proposal not found');
    const response: ApiResponse<MultisigProposal> = {
      success: true,
      data: proposal,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/v1/squads/proposal/:id/status
 *
 * Promote a proposal between lifecycle states. Squads is the source of
 * truth on chain; this endpoint just keeps the dashboard mirror in sync
 * after the operator votes / executes from the Squads UI.
 */
router.patch(
  '/proposal/:id/status',
  validateBody(ProposalStatusUpdateSchema),
  async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const body = req.body as z.infer<typeof ProposalStatusUpdateSchema>;
      const updated = await updateProposalStatus({
        id,
        status: body.status,
        approvalCount: body.approval_count,
        rejectionCount: body.rejection_count,
        executedTx: body.executed_tx,
      });
      if (!updated) throw new AppError(404, 'Proposal not found');
      const response: ApiResponse<MultisigProposal> = {
        success: true,
        data: updated,
        error: null,
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
