import { Connection, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import type { MultisigMember, MultisigOnchainSnapshot } from '@aperture/types';

/**
 * Squads V4 program ID — same on Devnet and Mainnet.
 * @see https://docs.squads.so/main/development/squads-program
 */
export const SQUADS_V4_PROGRAM_ID = new PublicKey(
  'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
);

let cachedConnection: Connection | null = null;

function getConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(config.solanaRpcUrl, 'confirmed');
  }
  return cachedConnection;
}

/**
 * Compute the vault PDA for a given multisig + vault index. Mirrors the
 * derivation done by the Policy Registry program in
 * programs/policy-registry/src/instructions/set_multisig.rs.
 */
export function deriveVaultPda(
  multisigKey: PublicKey,
  vaultIndex: number,
): PublicKey {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('multisig'),
      multisigKey.toBuffer(),
      Buffer.from('vault'),
      Buffer.from([vaultIndex]),
    ],
    SQUADS_V4_PROGRAM_ID,
  );
  return vaultPda;
}

interface FetchedSquadsMember {
  readonly key: PublicKey;
  readonly permissions: { mask: number };
}

/**
 * Read a Squads V4 multisig from chain and return the metadata Aperture
 * cares about — threshold, members, vault PDA at the requested index, and
 * the running transaction index.
 *
 * Throws if the account doesn't exist or isn't owned by the Squads
 * program — callers should treat this as a 404 / 422 boundary.
 */
export async function fetchMultisigSnapshot(
  multisigAddress: string,
  vaultIndex: number,
): Promise<MultisigOnchainSnapshot> {
  const connection = getConnection();
  let multisigPubkey: PublicKey;
  try {
    multisigPubkey = new PublicKey(multisigAddress);
  } catch (error) {
    throw new Error(`Invalid multisig address: ${multisigAddress}`);
  }

  const accountInfo = await connection.getAccountInfo(multisigPubkey);
  if (!accountInfo) {
    throw new Error(`Multisig account not found on Solana: ${multisigAddress}`);
  }
  if (!accountInfo.owner.equals(SQUADS_V4_PROGRAM_ID)) {
    throw new Error(
      `Account ${multisigAddress} is not owned by Squads V4 program`,
    );
  }

  const account = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPubkey,
  );

  const members: MultisigMember[] = (account.members as unknown as FetchedSquadsMember[]).map(
    (member) => ({
      key: member.key.toBase58(),
      permissionsMask: member.permissions.mask,
    }),
  );

  const vaultPda = deriveVaultPda(multisigPubkey, vaultIndex);

  const transactionIndex = Number(account.transactionIndex);
  if (!Number.isFinite(transactionIndex)) {
    logger.warn('Squads transactionIndex did not fit in a JS number', {
      raw: String(account.transactionIndex),
    });
  }

  return {
    multisigAddress,
    threshold: account.threshold,
    members,
    vaultPda: vaultPda.toBase58(),
    transactionIndex: Number.isFinite(transactionIndex) ? transactionIndex : 0,
  };
}
