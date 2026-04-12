import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import type { ApiResponse } from '@aperture/types';
import { validateBody } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { query } from '../utils/database.js';
import { logger } from '../utils/logger.js';

const router = Router();

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(password + salt).digest('hex');
}

function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

const SignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255).optional(),
});

const SignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const WalletAuthSchema = z.object({
  wallet_address: z.string().min(32).max(44),
  signature: z.string().min(1),
  message: z.string().min(1),
});

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string | null;
  wallet_address: string | null;
  created_at: Date;
}

interface UserResponse {
  id: string;
  email: string;
  name: string | null;
  wallet_address: string | null;
}

/**
 * @swagger
 * /api/v1/auth/signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 */
router.post('/signup', validateBody(SignUpSchema), async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    const existing = await query<UserRow>(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      throw new AppError(409, 'User with this email already exists');
    }

    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt) + ':' + salt;

    const result = await query<UserRow>(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3) RETURNING *`,
      [email.toLowerCase(), passwordHash, name ?? email.split('@')[0]]
    );

    const user = result.rows[0];
    const response: ApiResponse<UserResponse> = {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        wallet_address: user.wallet_address,
      },
      error: null,
    };

    logger.info('User registered', { user_id: user.id, email: user.email });
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/auth/signin:
 *   post:
 *     summary: Sign in with email and password
 *     tags: [Auth]
 */
router.post('/signin', validateBody(SignInSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await query<UserRow>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new AppError(401, 'Invalid email or password');
    }

    const user = result.rows[0];
    const [storedHash, salt] = user.password_hash.split(':');
    const inputHash = hashPassword(password, salt);

    if (inputHash !== storedHash) {
      throw new AppError(401, 'Invalid email or password');
    }

    const response: ApiResponse<UserResponse> = {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        wallet_address: user.wallet_address,
      },
      error: null,
    };

    logger.info('User signed in', { user_id: user.id });
    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/auth/wallet:
 *   post:
 *     summary: Authenticate or register with wallet address
 *     tags: [Auth]
 */
router.post('/wallet', validateBody(WalletAuthSchema), async (req, res, next) => {
  try {
    const { wallet_address, signature, message } = req.body;

    const { PublicKey } = await import('@solana/web3.js');
    const nacl = await import('tweetnacl');

    const publicKey = new PublicKey(wallet_address);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = Buffer.from(signature, 'base64');

    const isValid = nacl.default.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );

    if (!isValid) {
      throw new AppError(401, 'Invalid wallet signature');
    }

    let result = await query<UserRow>(
      'SELECT * FROM users WHERE wallet_address = $1',
      [wallet_address]
    );

    if (result.rows.length === 0) {
      const salt = generateSalt();
      const placeholderHash = hashPassword(randomBytes(32).toString('hex'), salt) + ':' + salt;

      result = await query<UserRow>(
        `INSERT INTO users (email, password_hash, name, wallet_address)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [
          `${wallet_address.slice(0, 8)}@wallet.aperture`,
          placeholderHash,
          wallet_address.slice(0, 8),
          wallet_address,
        ]
      );

      logger.info('Wallet user registered', { wallet: wallet_address });
    }

    const user = result.rows[0];
    const response: ApiResponse<UserResponse> = {
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        wallet_address: user.wallet_address,
      },
      error: null,
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
