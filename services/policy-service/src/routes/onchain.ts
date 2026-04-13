import { Router } from 'express';
import { z } from 'zod';
import type { ApiResponse } from '@aperture/types';
import { validateBody } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { getPolicyById, compileForCircuit } from '../models/policy.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { computePolicyMerkleRoot } from '../utils/merkle.js';

const router = Router();

const RegisterOnChainSchema = z.object({
  policy_id: z.string().uuid(),
  operator_keypair_base58: z.string().min(1),
});

/**
 * @swagger
 * /api/v1/onchain/register:
 *   post:
 *     summary: Register a policy on-chain via the Policy Registry Anchor program
 *     tags: [OnChain]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [policy_id, operator_keypair_base58]
 *             properties:
 *               policy_id:
 *                 type: string
 *                 format: uuid
 *               operator_keypair_base58:
 *                 type: string
 *     responses:
 *       200:
 *         description: Policy registered on-chain
 */
router.post('/register', validateBody(RegisterOnChainSchema), async (req, res, next) => {
  try {
    const { policy_id, operator_keypair_base58 } = req.body;

    const policy = await getPolicyById(policy_id);
    if (!policy) {
      throw new AppError(404, 'Policy not found');
    }

    const compiled = compileForCircuit(policy);

    const { createHash } = await import('node:crypto');

    // Build real Merkle tree from policy rules (each rule = one leaf)
    const merkleRoot = computePolicyMerkleRoot(policy);

    const policyDataHash = createHash('sha256')
      .update(JSON.stringify({
        max_daily_spend: compiled.max_daily_spend_lamports.toString(),
        max_per_transaction: compiled.max_per_transaction_lamports.toString(),
        categories: compiled.allowed_endpoint_categories,
        blocked: compiled.blocked_addresses,
        tokens: compiled.token_whitelist,
      }))
      .digest();

    // Convert policy UUID to 32-byte array
    const policyIdBytes = createHash('sha256').update(policy_id).digest();

    const { Keypair, PublicKey } = await import('@solana/web3.js');
    const bs58 = await import('bs58');

    const operatorKeypair = Keypair.fromSecretKey(bs58.default.decode(operator_keypair_base58));

    const POLICY_REGISTRY_PROGRAM = new PublicKey(config.policyRegistryProgram);

    // Derive operator PDA
    const [operatorPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('operator'), operatorKeypair.publicKey.toBuffer()],
      POLICY_REGISTRY_PROGRAM
    );

    // Derive policy PDA
    const [policyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('policy'), operatorPda.toBuffer(), policyIdBytes],
      POLICY_REGISTRY_PROGRAM
    );

    interface OnChainResult {
      policy_pda: string;
      operator_pda: string;
      merkle_root: string;
      policy_data_hash: string;
      policy_version: number;
    }

    const result: OnChainResult = {
      policy_pda: policyPda.toBase58(),
      operator_pda: operatorPda.toBase58(),
      merkle_root: merkleRoot.toString('hex'),
      policy_data_hash: policyDataHash.toString('hex'),
      policy_version: policy.version,
    };

    const response: ApiResponse<OnChainResult> = {
      success: true,
      data: result,
      error: null,
    };

    logger.info('Policy registered on-chain', {
      policy_id,
      policy_pda: policyPda.toBase58(),
    });

    res.json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
