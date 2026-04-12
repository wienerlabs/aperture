import { Router } from 'express';
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
} from '../models/policy.js';

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

export default router;
