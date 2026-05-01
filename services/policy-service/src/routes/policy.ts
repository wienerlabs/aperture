import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PolicySchema } from '@aperture/types';
import type { ApiResponse, PaginatedResponse, Policy } from '@aperture/types';
import { validateBody } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import {
  createPolicy,
  getPolicyById,
  getPoliciesByOperator,
  updatePolicy,
  deletePolicy,
  compileForCircuit,
  applyOnchainConfirmation,
  applyOnchainFailure,
} from '../models/policy.js';
import {
  buildPolicyMerkleTree,
  getMerkleProof,
  verifyMerkleProof,
} from '../utils/merkle.js';
import { syncPolicyOnchainState } from '../utils/onchain-sync.js';

const router = Router();

const UUIDSchema = z.string().uuid();
const OperatorIdSchema = z.string().min(1).max(64);

const PolicyUpdateSchema = PolicySchema.partial().omit({ operator_id: true });

function paramAsString(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * @swagger
 * /api/v1/policies:
 *   post:
 *     summary: Create a new policy
 *     tags: [Policies]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PolicyInput'
 *     responses:
 *       201:
 *         description: Policy created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PolicyResponse'
 *       400:
 *         description: Validation error
 */
router.post('/', validateBody(PolicySchema), async (req, res, next) => {
  try {
    const policy = await createPolicy(req.body);
    const response: ApiResponse<Policy> = {
      success: true,
      data: policy,
      error: null,
    };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/policies/{id}:
 *   get:
 *     summary: Get policy by ID
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Policy found
 *       404:
 *         description: Policy not found
 */
router.get('/:id', async (req, res, next) => {
  try {
    const id = paramAsString(req.params.id);
    const parseResult = UUIDSchema.safeParse(id);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid policy ID format');
    }

    const policy = await getPolicyById(id);
    if (!policy) {
      throw new AppError(404, 'Policy not found');
    }

    const response: ApiResponse<Policy> = {
      success: true,
      data: policy,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/policies/operator/{operatorId}:
 *   get:
 *     summary: List policies by operator
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: operatorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: active_only
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: Paginated list of policies
 */
router.get('/operator/:operatorId', async (req, res, next) => {
  try {
    const operatorId = paramAsString(req.params.operatorId);
    const parseResult = OperatorIdSchema.safeParse(operatorId);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid operator ID format');
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const activeOnly = req.query.active_only === 'true';

    const { policies, total } = await getPoliciesByOperator(
      operatorId,
      page,
      limit,
      activeOnly
    );

    const response: PaginatedResponse<Policy> = {
      success: true,
      data: policies,
      pagination: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/policies/{id}:
 *   put:
 *     summary: Update a policy
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PolicyUpdate'
 *     responses:
 *       200:
 *         description: Policy updated
 *       404:
 *         description: Policy not found
 */
router.put('/:id', validateBody(PolicyUpdateSchema), async (req, res, next) => {
  try {
    const id = paramAsString(req.params.id);
    const parseResult = UUIDSchema.safeParse(id);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid policy ID format');
    }

    const policy = await updatePolicy(id, req.body);
    if (!policy) {
      throw new AppError(404, 'Policy not found');
    }

    const response: ApiResponse<Policy> = {
      success: true,
      data: policy,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/policies/{id}:
 *   delete:
 *     summary: Delete a policy
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Policy deleted
 *       404:
 *         description: Policy not found
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const id = paramAsString(req.params.id);
    const parseResult = UUIDSchema.safeParse(id);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid policy ID format');
    }

    const deleted = await deletePolicy(id);
    if (!deleted) {
      throw new AppError(404, 'Policy not found');
    }

    const response: ApiResponse<{ deleted: true }> = {
      success: true,
      data: { deleted: true },
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/policies/{id}/compile:
 *   get:
 *     summary: Compile policy to RISC Zero circuit input format
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Compiled policy for circuit consumption
 *       404:
 *         description: Policy not found
 */
router.get('/:id/compile', async (req, res, next) => {
  try {
    const id = paramAsString(req.params.id);
    const parseResult = UUIDSchema.safeParse(id);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid policy ID format');
    }

    const policy = await getPolicyById(id);
    if (!policy) {
      throw new AppError(404, 'Policy not found');
    }

    const compiled = compileForCircuit(policy);
    const serialized = {
      ...compiled,
      max_daily_spend_lamports: compiled.max_daily_spend_lamports.toString(),
      max_per_transaction_lamports: compiled.max_per_transaction_lamports.toString(),
    };

    const response: ApiResponse<typeof serialized> = {
      success: true,
      data: serialized,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/policies/{id}/merkle-tree:
 *   get:
 *     summary: Get the Merkle tree for a policy
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Merkle tree with root, leaves, and labels
 *       404:
 *         description: Policy not found
 */
router.get('/:id/merkle-tree', async (req, res, next) => {
  try {
    const id = paramAsString(req.params.id);
    const parseResult = UUIDSchema.safeParse(id);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid policy ID format');
    }

    const policy = await getPolicyById(id);
    if (!policy) {
      throw new AppError(404, 'Policy not found');
    }

    const tree = buildPolicyMerkleTree(policy);

    const response: ApiResponse<{
      root: string;
      leaf_count: number;
      labels: readonly string[];
      leaves: string[];
    }> = {
      success: true,
      data: {
        root: tree.root.toString('hex'),
        leaf_count: tree.leaves.length,
        labels: tree.labels,
        leaves: tree.leaves.map(l => l.toString('hex')),
      },
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/policies/{id}/merkle-proof/{rule}:
 *   get:
 *     summary: Get a Merkle proof for a specific policy rule
 *     description: >
 *       Enables selective disclosure: prove a specific rule exists
 *       in the policy without revealing other rules.
 *     tags: [Policies]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: rule
 *         required: true
 *         schema:
 *           type: string
 *           enum: [max_daily_spend, max_per_transaction, allowed_categories, blocked_addresses, token_whitelist, time_restrictions]
 *     responses:
 *       200:
 *         description: Merkle proof for the specified rule
 *       400:
 *         description: Invalid rule name
 *       404:
 *         description: Policy not found
 */
router.get('/:id/merkle-proof/:rule', async (req, res, next) => {
  try {
    const id = paramAsString(req.params.id);
    const rule = paramAsString(req.params.rule);

    const parseResult = UUIDSchema.safeParse(id);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid policy ID format');
    }

    const policy = await getPolicyById(id);
    if (!policy) {
      throw new AppError(404, 'Policy not found');
    }

    const tree = buildPolicyMerkleTree(policy);
    const ruleIndex = tree.labels.indexOf(rule);

    if (ruleIndex === -1) {
      throw new AppError(400, `Invalid rule name: ${rule}. Valid rules: ${tree.labels.join(', ')}`);
    }

    const proof = getMerkleProof(tree, ruleIndex);

    // Verify the proof is valid before returning
    const isValid = verifyMerkleProof(proof.leaf, proof.proof, proof.directions, proof.root);

    const response: ApiResponse<typeof proof & { verified: boolean }> = {
      success: true,
      data: { ...proof, verified: isValid },
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * Returns the canonical on-chain payload the wallet client must sign to
 * register or update a policy in the policy-registry program. The dashboard
 * MUST source merkle_root_hex / policy_data_hash_hex from this endpoint and
 * never recompute them locally — the policy-service is the single source of
 * truth for the commitment.
 *
 * - operation: 'register' if no PolicyAccount exists yet for this policy,
 *              'update' if the policy is already registered but the DB
 *              commitment has drifted (status='pending' after edits).
 * - policy_id_bytes_hex: the 32-byte seed used to derive the PolicyAccount PDA;
 *                        deterministic SHA-256 over the policy UUID string.
 */
const ONCHAIN_PAYLOAD_RULES = ['register', 'update', 'noop'] as const;
type OnchainOperation = (typeof ONCHAIN_PAYLOAD_RULES)[number];

interface OnchainPayloadResponse {
  readonly policy_id: string;
  readonly policy_id_bytes_hex: string;
  readonly merkle_root_hex: string;
  readonly policy_data_hash_hex: string;
  readonly version: number;
  readonly operator_id: string;
  readonly onchain_status: Policy['onchain_status'];
  readonly onchain_pda: string | null;
  readonly onchain_version: number | null;
  readonly operation: OnchainOperation;
}

router.get('/:id/onchain-payload', async (req, res, next) => {
  try {
    const id = paramAsString(req.params.id);
    const parseResult = UUIDSchema.safeParse(id);
    if (!parseResult.success) {
      throw new AppError(400, 'Invalid policy ID format');
    }

    // Reconcile DB with the on-chain PolicyAccount before deciding which
    // operation to advertise. Without this step a dashboard session that
    // signed register_policy successfully but failed the follow-up
    // confirmation PATCH (e.g. CORS, browser closed) would keep getting
    // operation='register' and fail with "account already in use".
    const sync = await syncPolicyOnchainState(id);
    const policy = sync.policy;
    if (!policy) {
      throw new AppError(404, 'Policy not found');
    }
    if (!policy.merkle_root_hex || !policy.policy_data_hash_hex) {
      // This should not happen for any policy created after migration 005,
      // but legacy rows backfilled before the model rebuild may land here.
      // Surface it explicitly so the caller can trigger a backfill instead
      // of silently signing nothing.
      throw new AppError(
        500,
        'Policy is missing on-chain commitments — needs backfill (run policy update)'
      );
    }

    const policyIdBytes = createHash('sha256').update(policy.id).digest('hex');

    const operation: OnchainOperation =
      policy.onchain_pda === null
        ? 'register'
        : policy.onchain_status === 'pending'
          ? 'update'
          : 'noop';

    const payload: OnchainPayloadResponse = {
      policy_id: policy.id,
      policy_id_bytes_hex: policyIdBytes,
      merkle_root_hex: policy.merkle_root_hex,
      policy_data_hash_hex: policy.policy_data_hash_hex,
      version: policy.version,
      operator_id: policy.operator_id,
      onchain_status: policy.onchain_status,
      onchain_pda: policy.onchain_pda,
      onchain_version: policy.onchain_version,
      operation,
    };

    const response: ApiResponse<OnchainPayloadResponse> = {
      success: true,
      data: payload,
      error: null,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
});

const Base58String = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Must be base58');

const Hex64String = z.string().length(64).regex(/^[0-9a-f]+$/i, 'Must be 64 hex chars');

const OnchainConfirmationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('registered'),
    tx_signature: Base58String,
    onchain_pda: Base58String,
    onchain_version: z.number().int().positive(),
    merkle_root_hex: Hex64String,
    policy_data_hash_hex: Hex64String,
  }),
  z.object({
    status: z.literal('failed'),
    error_message: z.string().min(1).max(1000),
  }),
]);

router.patch(
  '/:id/onchain-confirmation',
  validateBody(OnchainConfirmationSchema),
  async (req, res, next) => {
    try {
      const id = paramAsString(req.params.id);
      const parseResult = UUIDSchema.safeParse(id);
      if (!parseResult.success) {
        throw new AppError(400, 'Invalid policy ID format');
      }

      const body = req.body as z.infer<typeof OnchainConfirmationSchema>;

      let updated: Policy | null;
      if (body.status === 'registered') {
        try {
          updated = await applyOnchainConfirmation(id, {
            tx_signature: body.tx_signature,
            onchain_pda: body.onchain_pda,
            onchain_version: body.onchain_version,
            merkle_root_hex: body.merkle_root_hex,
            policy_data_hash_hex: body.policy_data_hash_hex,
          });
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('OnchainCommitmentMismatch')) {
            throw new AppError(
              409,
              'Policy commitment changed since /onchain-payload was fetched. Refetch and re-sign.'
            );
          }
          throw err;
        }
      } else {
        updated = await applyOnchainFailure(id, body.error_message);
      }

      if (!updated) {
        throw new AppError(404, 'Policy not found');
      }

      const response: ApiResponse<Policy> = {
        success: true,
        data: updated,
        error: null,
      };
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
