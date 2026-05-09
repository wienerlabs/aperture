/**
 * squads-binder.ts — server-side automation of the create-multisig + bind
 * flow. Mirrors scripts/squads-devnet-bind.ts but exposes a single
 * function the HTTP layer can call so the dashboard can do the whole
 * thing with one button tap.
 *
 * Devnet only: the function generates a fresh operator keypair, asks the
 * faucet for SOL, calls multisigCreateV2, then initialise_operator +
 * set_multisig on the policy-registry. The caller receives the keypair
 * bytes back so the operator can persist them locally — there is no
 * server-side custody.
 *
 * Mainnet rejects the call (403) so secret material is never generated
 * on a network where it might hold real value. Production multisig
 * binding goes through the existing wallet-signing path.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { config } from '../config.js';
import { logger } from './logger.js';

const SET_MULTISIG_DISC = Buffer.from([251, 6, 245, 35, 115, 42, 77, 186]);
const INITIALIZE_OPERATOR_DISC = Buffer.from([
  155, 33, 216, 254, 233, 227, 175, 212,
]);

export type SquadsBinderErrorKind =
  | 'forbidden'
  | 'airdrop_failed'
  | 'treasury_unavailable'
  | 'treasury_underfunded'
  | 'invalid_threshold'
  | 'invalid_member'
  | 'multisig_create_failed'
  | 'aperture_bind_failed';

export class SquadsBinderError extends Error {
  public readonly kind: SquadsBinderErrorKind;
  constructor(kind: SquadsBinderErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'SquadsBinderError';
  }
}

export interface CreateAndBindArgs {
  readonly threshold?: number;
  readonly extraMembers?: readonly string[];
  readonly label?: string;
  readonly vaultIndex?: number;
}

export interface CreateAndBindMember {
  readonly key: string;
  readonly permissionsMask: number;
}

export interface CreateAndBindResult {
  readonly operatorAuthority: string;
  readonly multisigAddress: string;
  readonly vaultPda: string;
  readonly vaultIndex: number;
  readonly threshold: number;
  readonly members: readonly CreateAndBindMember[];
  readonly signatures: {
    readonly create: string;
    readonly bind: string;
  };
  // Raw secret key bytes for the freshly generated operator authority.
  // Returned ONCE so the caller can persist it client-side; never logged
  // or stored server-side.
  readonly keypairBytes: readonly number[];
}

function deriveOperatorPda(
  authority: PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    programId,
  )[0];
}

function buildInitializeOperatorIx(
  authority: PublicKey,
  programId: PublicKey,
  operatorName: string,
): TransactionInstruction {
  const operatorPda = deriveOperatorPda(authority, programId);
  const nameBytes = Buffer.from(operatorName, 'utf-8');
  const data = Buffer.alloc(8 + 4 + nameBytes.length);
  INITIALIZE_OPERATOR_DISC.copy(data, 0);
  data.writeUInt32LE(nameBytes.length, 8);
  nameBytes.copy(data, 12);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildSetMultisigIx(
  authority: PublicKey,
  squadsMultisig: PublicKey,
  vaultIndex: number,
  programId: PublicKey,
): TransactionInstruction {
  const operatorPda = deriveOperatorPda(authority, programId);
  const data = Buffer.alloc(8 + 1);
  SET_MULTISIG_DISC.copy(data, 0);
  data.writeUInt8(vaultIndex, 8);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: squadsMultisig, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function isDevnet(): boolean {
  const network = process.env.SOLANA_NETWORK ?? 'devnet';
  return network === 'devnet' || network === 'testnet';
}

const FUND_LAMPORTS = 0.08 * LAMPORTS_PER_SOL;
const TREASURY_MIN_RESERVE = 0.05 * LAMPORTS_PER_SOL;

let cachedTreasury: Keypair | null = null;

function loadTreasuryKeypair(): Keypair | null {
  if (cachedTreasury) return cachedTreasury;
  const keypairPath = process.env.SQUADS_TREASURY_KEYPAIR_PATH;
  if (!keypairPath) return null;
  const resolved = path.resolve(keypairPath);
  if (!fs.existsSync(resolved)) {
    logger.warn('Treasury keypair path set but file missing', { path: resolved });
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  if (!Array.isArray(raw)) {
    logger.warn('Treasury keypair file is not a byte array', { path: resolved });
    return null;
  }
  cachedTreasury = Keypair.fromSecretKey(Uint8Array.from(raw));
  return cachedTreasury;
}

/**
 * Fund the freshly generated operator. Tries the configured treasury
 * keypair first (reliable, costs almost nothing per bind); falls back
 * to the public devnet faucet when no treasury is configured.
 */
async function fundOperator(
  conn: Connection,
  operator: PublicKey,
): Promise<void> {
  const treasury = loadTreasuryKeypair();
  if (treasury) {
    const treasuryBalance = await conn.getBalance(treasury.publicKey);
    if (treasuryBalance < FUND_LAMPORTS + TREASURY_MIN_RESERVE) {
      throw new SquadsBinderError(
        'treasury_underfunded',
        `Squads binder treasury (${treasury.publicKey.toBase58()}) has ${(
          treasuryBalance / LAMPORTS_PER_SOL
        ).toFixed(4)} SOL but needs at least ${(
          (FUND_LAMPORTS + TREASURY_MIN_RESERVE) / LAMPORTS_PER_SOL
        ).toFixed(4)} SOL. Top it up at https://faucet.solana.com.`,
      );
    }
    const ix = SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: operator,
      lamports: FUND_LAMPORTS,
    });
    const { blockhash } = await conn.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: treasury.publicKey,
      recentBlockhash: blockhash,
    }).add(ix);
    tx.sign(treasury);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, 'confirmed');
    logger.info('Treasury funded operator', {
      treasury: treasury.publicKey.toBase58(),
      operator: operator.toBase58(),
      lamports: FUND_LAMPORTS,
      signature: sig,
    });
    return;
  }

  // No treasury → try the public faucet (commonly rate-limited).
  try {
    const sig = await conn.requestAirdrop(operator, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
  } catch (err) {
    throw new SquadsBinderError(
      'airdrop_failed',
      `Devnet airdrop failed and no treasury keypair is configured. Set SQUADS_TREASURY_KEYPAIR_PATH so binds don't depend on the public faucet. Underlying error: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * End-to-end create + bind. Single network round-trip per Solana
 * transaction; the airdrop attempt is best-effort and surfaces a clean
 * error when the public faucet rate-limits us.
 */
export async function createAndBindMultisig(
  args: CreateAndBindArgs,
): Promise<CreateAndBindResult> {
  if (!isDevnet()) {
    throw new SquadsBinderError(
      'forbidden',
      'Automated bind is devnet-only. Bind via the dashboard wallet flow on mainnet.',
    );
  }

  const threshold = args.threshold ?? 1;
  const vaultIndex = args.vaultIndex ?? 0;
  const extraMembers = args.extraMembers ?? [];

  if (threshold < 1 || threshold > 10) {
    throw new SquadsBinderError(
      'invalid_threshold',
      'Threshold must be between 1 and 10',
    );
  }

  // Validate extra members up front so we fail before touching the chain.
  const extraMemberKeys: PublicKey[] = [];
  for (const addr of extraMembers) {
    try {
      extraMemberKeys.push(new PublicKey(addr));
    } catch {
      throw new SquadsBinderError(
        'invalid_member',
        `Member "${addr}" is not a valid base58 public key`,
      );
    }
  }

  const totalMembers = 1 + extraMemberKeys.length;
  if (threshold > totalMembers) {
    throw new SquadsBinderError(
      'invalid_threshold',
      `Threshold ${threshold} cannot exceed total member count ${totalMembers}`,
    );
  }

  const conn = new Connection(config.solanaRpcUrl, 'confirmed');
  const operator = Keypair.generate();
  logger.info('Squads automated bind: keypair generated', {
    operatorAuthority: operator.publicKey.toBase58(),
  });

  // ------- 1. Fund the operator (treasury → fallback to faucet) -------
  await fundOperator(conn, operator.publicKey);

  // ------- 2. multisigCreateV2 -------
  const members = [
    { key: operator.publicKey, permissions: multisig.types.Permissions.all() },
    ...extraMemberKeys.map((key) => ({
      key,
      permissions: multisig.types.Permissions.all(),
    })),
  ];

  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const programConfigPda = multisig.getProgramConfigPda({})[0];
  let treasury: PublicKey;
  try {
    const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
      conn,
      programConfigPda,
    );
    treasury = programConfig.treasury;
  } catch (err) {
    throw new SquadsBinderError(
      'multisig_create_failed',
      `Failed to read Squads program config: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let createSig: string;
  try {
    const createIx = await multisig.instructions.multisigCreateV2({
      createKey: createKey.publicKey,
      creator: operator.publicKey,
      multisigPda,
      configAuthority: null,
      timeLock: 0,
      members,
      threshold,
      treasury,
      rentCollector: null,
    });
    const { blockhash } = await conn.getLatestBlockhash();
    const createTx = new Transaction({
      feePayer: operator.publicKey,
      recentBlockhash: blockhash,
    }).add(createIx);
    createTx.sign(operator, createKey);
    createSig = await conn.sendRawTransaction(createTx.serialize());
    await conn.confirmTransaction(createSig, 'confirmed');
  } catch (err) {
    throw new SquadsBinderError(
      'multisig_create_failed',
      `multisigCreateV2 failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  logger.info('Squads automated bind: multisig created', {
    multisigAddress: multisigPda.toBase58(),
    signature: createSig,
  });

  // ------- 3. initialise_operator + set_multisig in one tx -------
  const programId = new PublicKey(config.policyRegistryProgram);
  const operatorPda = deriveOperatorPda(operator.publicKey, programId);

  const apertureIxs: TransactionInstruction[] = [];
  const operatorInfo = await conn.getAccountInfo(operatorPda);
  if (!operatorInfo) {
    apertureIxs.push(
      buildInitializeOperatorIx(
        operator.publicKey,
        programId,
        args.label ??
          `Aperture op ${operator.publicKey.toBase58().slice(0, 6)}`,
      ),
    );
  }
  apertureIxs.push(
    buildSetMultisigIx(operator.publicKey, multisigPda, vaultIndex, programId),
  );

  let bindSig: string;
  try {
    const { blockhash } = await conn.getLatestBlockhash();
    const apertureTx = new Transaction({
      feePayer: operator.publicKey,
      recentBlockhash: blockhash,
    });
    apertureIxs.forEach((ix) => apertureTx.add(ix));
    apertureTx.sign(operator);
    bindSig = await conn.sendRawTransaction(apertureTx.serialize());
    await conn.confirmTransaction(bindSig, 'confirmed');
  } catch (err) {
    throw new SquadsBinderError(
      'aperture_bind_failed',
      `Aperture initialise_operator + set_multisig failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: vaultIndex,
  });

  logger.info('Squads automated bind: complete', {
    operatorAuthority: operator.publicKey.toBase58(),
    multisigAddress: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    bindSignature: bindSig,
  });

  return {
    operatorAuthority: operator.publicKey.toBase58(),
    multisigAddress: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    vaultIndex,
    threshold,
    members: members.map((m) => ({
      key: m.key.toBase58(),
      permissionsMask: m.permissions.mask,
    })),
    signatures: { create: createSig, bind: bindSig },
    keypairBytes: Array.from(operator.secretKey),
  };
}
