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

// Owner programs we recognise when a wrong-owner mismatch fires. Keeping
// the list here (instead of in the route handler) means the same labels
// surface in the JSON response and in any future logs / alerts.
const WELL_KNOWN_OWNERS: Record<string, string> = {
  '11111111111111111111111111111111': 'System Program (regular wallet)',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token program (token account)',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'SPL Token-2022 program (token account)',
  // Legacy Squads versions — common paste mistake when migrating from V3.
  SMPLecH534NA9acpos4G6x7uf3LWbCAwZQE9e8ZekMu: 'Squads V3 (legacy, not supported)',
  // BPF Loader Upgradeable, used by the Squads V4 program itself.
  BPFLoaderUpgradeab1e11111111111111111111111: 'BPF Loader Upgradeable (program binary)',
};

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
    const err = new Error(`Invalid multisig address: ${multisigAddress}`);
    (err as Error & { kind?: string }).kind = 'invalid_address';
    throw err;
  }

  const accountInfo = await connection.getAccountInfo(multisigPubkey);
  if (!accountInfo) {
    const err = new Error(`Multisig account not found on Solana: ${multisigAddress}`);
    (err as Error & { kind?: string }).kind = 'not_found';
    throw err;
  }
  if (!accountInfo.owner.equals(SQUADS_V4_PROGRAM_ID)) {
    // Map well-known owners to a human label so the dashboard can render
    // "this looks like a wallet" instead of an opaque program id. We
    // hand-roll this list because most operators paste either their own
    // wallet pubkey or an old Squads V3 multisig by mistake.
    const ownerString = accountInfo.owner.toBase58();
    const ownerLabel = WELL_KNOWN_OWNERS[ownerString] ?? null;
    const err = new Error(
      ownerLabel
        ? `Account ${multisigAddress} is owned by ${ownerLabel} (${ownerString}), not Squads V4. Make sure you pasted the multisig PDA, not your wallet pubkey or a Squads V3 address.`
        : `Account ${multisigAddress} is owned by ${ownerString}, not the Squads V4 program. Verify the address belongs to a Squads V4 multisig.`,
    );
    (err as Error & { kind?: string; ownerProgram?: string; ownerLabel?: string }).kind = 'wrong_owner';
    (err as Error & { ownerProgram?: string }).ownerProgram = ownerString;
    if (ownerLabel) {
      (err as Error & { ownerLabel?: string }).ownerLabel = ownerLabel;
    }
    throw err;
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
