import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { query } from '../utils/database.js';
import { AppError } from '../middleware/error-handler.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const API_KEY_PREFIX = 'apk_';

interface ApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  key_hash: string;
  last_used_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  masked_key: string;
  last_used_at: string | null;
  created_at: string;
}

function toSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    masked_key: `${row.prefix}${'•'.repeat(24)}`,
    last_used_at: row.last_used_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  };
}

function generateApiKey(): { fullKey: string; prefix: string; keyHash: string } {
  const random = randomBytes(32).toString('hex');
  const fullKey = `${API_KEY_PREFIX}${random}`;
  const prefix = fullKey.slice(0, 12);
  const keyHash = createHash('sha256').update(fullKey).digest('hex');
  return { fullKey, prefix, keyHash };
}

/**
 * @openapi
 * components:
 *   schemas:
 *     ApiKeySummary:
 *       type: object
 *       properties:
 *         id: { type: string, format: uuid }
 *         name: { type: string }
 *         prefix: { type: string, example: "apk_a1b2c3d4" }
 *         masked_key: { type: string }
 *         last_used_at: { type: string, format: date-time, nullable: true }
 *         created_at: { type: string, format: date-time }
 *     ApiKeyCreated:
 *       allOf:
 *         - $ref: '#/components/schemas/ApiKeySummary'
 *         - type: object
 *           required: [full_key]
 *           properties:
 *             full_key:
 *               type: string
 *               description: "Plain-text API key. Shown exactly once at creation time."
 */

const CreateApiKeySchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().min(1).max(120),
});

function parseUserId(req: Request): string {
  const raw = req.query.user_id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError(400, 'user_id query parameter is required');
  }
  if (!/^[0-9a-fA-F-]{32,36}$/.test(value)) {
    throw new AppError(400, 'user_id must be a UUID');
  }
  return value;
}

/**
 * @openapi
 * /api/v1/keys:
 *   post:
 *     summary: Create an API key
 *     description: Generates a new API key for the given user. The plain-text key is returned exactly once.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [user_id, name]
 *             properties:
 *               user_id: { type: string, format: uuid }
 *               name: { type: string, maxLength: 120 }
 *     responses:
 *       201:
 *         description: Key created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/ApiKeyCreated' }
 *       400: { description: Validation error }
 */
router.post('/', validateBody(CreateApiKeySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, name } = req.body as z.infer<typeof CreateApiKeySchema>;

    const userCheck = await query<{ id: string }>('SELECT id FROM users WHERE id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      throw new AppError(404, 'User not found');
    }

    const { fullKey, prefix, keyHash } = generateApiKey();
    const result = await query<ApiKeyRow>(
      `INSERT INTO api_keys (user_id, name, prefix, key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, name, prefix, key_hash, last_used_at, revoked_at, created_at`,
      [user_id, name, prefix, keyHash],
    );
    const row = result.rows[0]!;
    res.status(201).json({
      success: true,
      data: {
        ...toSummary(row),
        full_key: fullKey,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/keys:
 *   get:
 *     summary: List API keys for a user
 *     parameters:
 *       - in: query
 *         name: user_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: List of (non-revoked) keys
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ApiKeySummary' }
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseUserId(req);
    const result = await query<ApiKeyRow>(
      `SELECT id, user_id, name, prefix, key_hash, last_used_at, revoked_at, created_at
       FROM api_keys
       WHERE user_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [userId],
    );
    res.json({ success: true, data: result.rows.map(toSummary) });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/v1/keys/{id}:
 *   delete:
 *     summary: Revoke an API key
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: user_id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Revoked }
 *       404: { description: Key not found }
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = parseUserId(req);
    const { id } = req.params;
    if (!id) throw new AppError(400, 'id path parameter is required');
    const result = await query<{ id: string }>(
      `UPDATE api_keys
       SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [id, userId],
    );
    if (result.rowCount === 0) {
      throw new AppError(404, 'API key not found');
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export interface VerifiedApiKey {
  id: string;
  user_id: string;
}

export async function verifyApiKey(rawKey: string): Promise<VerifiedApiKey | null> {
  if (!rawKey.startsWith(API_KEY_PREFIX)) return null;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const result = await query<{ id: string; user_id: string }>(
    `UPDATE api_keys
     SET last_used_at = NOW()
     WHERE key_hash = $1 AND revoked_at IS NULL
     RETURNING id, user_id`,
    [keyHash],
  );
  return result.rows[0] ?? null;
}

export function requireApiKey() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.header('x-api-key');
      if (!header) throw new AppError(401, 'Missing X-API-Key header');
      const verified = await verifyApiKey(header);
      if (!verified) throw new AppError(401, 'Invalid or revoked API key');
      (req as Request & { apiKey?: VerifiedApiKey }).apiKey = verified;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export default router;
