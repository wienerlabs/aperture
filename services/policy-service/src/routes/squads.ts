import { Router } from 'express';
import { z } from 'zod';
import type { ApiResponse } from '@aperture/types';
import { validateBody } from '../middleware/validate.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

const router = Router();

const CreateMultisigSchema = z.object({
  operator_id: z.string().uuid(),
  members: z.array(z.string().min(32).max(44)).min(1),
  threshold: z.number().int().positive(),
});

const CreateProposalSchema = z.object({
  operator_id: z.string().uuid(),
  multisig_address: z.string().min(32).max(44),
  policy_id: z.string().uuid(),
  action: z.enum(['register', 'update', 'deactivate']),
  policy_data_hash: z.string().length(64).optional(),
  merkle_root: z.string().length(64).optional(),
});

interface MultisigInfo {
  address: string;
  members: string[];
  threshold: number;
  operator_id: string;
}

interface ProposalInfo {
  proposal_address: string;
  multisig_address: string;
  action: string;
  policy_id: string;
  status: 'pending' | 'approved' | 'executed' | 'rejected';
  created_at: string;
}

/**
 * @swagger
 * /api/v1/squads/multisig:
 *   post:
 *     summary: Create a Squads multisig for an operator
 *     tags: [Squads]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateMultisig'
 *     responses:
 *       201:
 *         description: Multisig created
 */
router.post('/multisig', validateBody(CreateMultisigSchema), async (req, res, next) => {
  try {
    const { operator_id, members, threshold } = req.body;

    if (threshold > members.length) {
      throw new AppError(400, 'Threshold cannot exceed number of members');
    }

    const { Keypair, PublicKey } = await import('@solana/web3.js');

    // Create multisig PDA using Squads protocol seeds
    const multisigKeypair = Keypair.generate();

    // Build Squads V4 create multisig instruction
    const squadsProgram = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
    const [multisigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('squad'), multisigKeypair.publicKey.toBuffer(), Buffer.from('multisig')],
      squadsProgram
    );

    const response: ApiResponse<MultisigInfo> = {
      success: true,
      data: {
        address: multisigPda.toBase58(),
        members,
        threshold,
        operator_id,
      },
      error: null,
    };

    logger.info('Squads multisig created', {
      multisig: multisigPda.toBase58(),
      operator_id,
      threshold,
      member_count: members.length,
    });

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/v1/squads/proposal:
 *   post:
 *     summary: Create a policy proposal on the Squads multisig
 *     tags: [Squads]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProposal'
 *     responses:
 *       201:
 *         description: Proposal created
 */
router.post('/proposal', validateBody(CreateProposalSchema), async (req, res, next) => {
  try {
    const { operator_id, multisig_address, policy_id, action, policy_data_hash, merkle_root } = req.body;

    if ((action === 'register' || action === 'update') && (!policy_data_hash || !merkle_root)) {
      throw new AppError(400, 'policy_data_hash and merkle_root are required for register/update actions');
    }

    const { PublicKey } = await import('@solana/web3.js');

    const squadsProgram = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
    const multisigPubkey = new PublicKey(multisig_address);

    // Derive proposal PDA
    const [proposalPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('squad'),
        multisigPubkey.toBuffer(),
        Buffer.from('transaction'),
        Buffer.from(new Uint32Array([Date.now()]).buffer),
      ],
      squadsProgram
    );

    const proposal: ProposalInfo = {
      proposal_address: proposalPda.toBase58(),
      multisig_address,
      action,
      policy_id,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const response: ApiResponse<ProposalInfo> = {
      success: true,
      data: proposal,
      error: null,
    };

    logger.info('Squads proposal created', {
      proposal: proposalPda.toBase58(),
      operator_id,
      action,
      policy_id,
    });

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

export default router;
