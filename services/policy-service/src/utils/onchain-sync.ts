/**
 * Bridges the policy-service DB with the on-chain PolicyAccount whose data
 * the policy-registry program owns. Two failure modes the sync logic
 * recovers from:
 *
 *   1. Dashboard already signed register_policy in a previous session, the
 *      tx confirmed, the PDA is live on Solana, but the follow-up
 *      `/onchain-confirmation` PATCH never reached the server (network
 *      blip, CORS, browser closed). The DB row is still 'pending' so the
 *      next "Anchor on-chain" click re-tries `init` and the program
 *      rejects it with "account already in use".
 *
 *   2. The PolicyAccount on-chain holds a different commitment than the DB
 *      currently advertises (operator changed the rules). The DB needs to
 *      know the on-chain version + mark itself 'pending' (a pending
 *      re-anchor has the right semantics here too).
 *
 * The helper is read-only against Solana and writes only to the DB row it
 * was asked about, so calling it speculatively is safe.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import type { Policy } from '@aperture/types';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { applyOnchainConfirmation, getPolicyById } from '../models/policy.js';
import { query } from './database.js';

const POLICY_REGISTRY_PROGRAM = new PublicKey(config.policyRegistryProgram);

let cachedConnection: Connection | null = null;
function getConnection(): Connection {
  if (!cachedConnection) {
    cachedConnection = new Connection(config.solanaRpcUrl, 'confirmed');
  }
  return cachedConnection;
}

interface DerivedPdas {
  readonly operatorPda: PublicKey;
  readonly policyPda: PublicKey;
  readonly policyIdBytes: Buffer;
}

function derivePdasForPolicy(operatorAuthority: string, policyUuid: string): DerivedPdas {
  const operatorPubkey = new PublicKey(operatorAuthority);
  const [operatorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), operatorPubkey.toBuffer()],
    POLICY_REGISTRY_PROGRAM,
  );
  const policyIdBytes = createHash('sha256').update(policyUuid).digest();
  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorPda.toBuffer(), policyIdBytes],
    POLICY_REGISTRY_PROGRAM,
  );
  return { operatorPda, policyPda, policyIdBytes };
}

/**
 * Anchor-style PolicyAccount layout written by the policy-registry program:
 *   8  disc
 *   32 operator
 *   32 policy_id
 *   32 merkle_root
 *   32 policy_data_hash
 *   4  version (u32 LE)
 *   1  active
 *   8  created_at (i64 LE)
 *   8  updated_at (i64 LE)
 *   1  bump
 * Total: 158 bytes.
 */
const OFF_MERKLE_ROOT = 8 + 32 + 32; // 72
const OFF_POLICY_DATA_HASH = OFF_MERKLE_ROOT + 32; // 104
const OFF_VERSION = OFF_POLICY_DATA_HASH + 32; // 136
const OFF_ACTIVE = OFF_VERSION + 4; // 140

interface OnchainPolicyState {
  readonly policyPda: string;
  readonly merkleRootHex: string;
  readonly policyDataHashHex: string;
  readonly version: number;
  readonly active: boolean;
}

async function readPolicyAccountState(policyPda: PublicKey): Promise<OnchainPolicyState | null> {
  const accountInfo = await getConnection().getAccountInfo(policyPda, 'confirmed');
  if (!accountInfo) return null;
  if (!accountInfo.owner.equals(POLICY_REGISTRY_PROGRAM)) return null;
  const data = accountInfo.data;
  if (data.length < OFF_ACTIVE + 1) return null;
  return {
    policyPda: policyPda.toBase58(),
    merkleRootHex: data.subarray(OFF_MERKLE_ROOT, OFF_MERKLE_ROOT + 32).toString('hex'),
    policyDataHashHex: data.subarray(OFF_POLICY_DATA_HASH, OFF_POLICY_DATA_HASH + 32).toString('hex'),
    version: data.readUInt32LE(OFF_VERSION),
    active: data[OFF_ACTIVE] === 1,
  };
}

export type SyncOutcome =
  | { kind: 'noop'; reason: string }
  | { kind: 'synced_to_registered'; pda: string; version: number }
  | { kind: 'commitment_drifted'; pda: string; on_chain_data_hash: string };

/**
 * Reconciles the DB row for `policyId` against whatever the policy-registry
 * program currently owns at the corresponding PDA. Pure data flow; no signing
 * happens here.
 */
export async function syncPolicyOnchainState(policyId: string): Promise<{
  policy: Policy | null;
  outcome: SyncOutcome;
}> {
  const policy = await getPolicyById(policyId);
  if (!policy) return { policy: null, outcome: { kind: 'noop', reason: 'policy not found' } };

  if (!policy.merkle_root_hex || !policy.policy_data_hash_hex) {
    return {
      policy,
      outcome: { kind: 'noop', reason: 'commitments missing; nothing to sync against' },
    };
  }

  const { policyPda } = derivePdasForPolicy(policy.operator_id, policy.id);
  const onchain = await readPolicyAccountState(policyPda);
  if (!onchain) {
    return { policy, outcome: { kind: 'noop', reason: 'no PolicyAccount at the derived PDA' } };
  }

  // PDA exists. If the DB already records this very PDA as registered with
  // matching commitments, nothing to do.
  if (
    policy.onchain_pda === onchain.policyPda &&
    policy.onchain_status === 'registered' &&
    policy.merkle_root_hex === onchain.merkleRootHex &&
    policy.policy_data_hash_hex === onchain.policyDataHashHex
  ) {
    return { policy, outcome: { kind: 'noop', reason: 'already in sync' } };
  }

  // If the DB commitments still match what is on-chain but onchain_pda or
  // status drifted (the dashboard race condition), backfill those fields
  // by piggy-backing on applyOnchainConfirmation. tx_signature is unknown
  // at sync time so we leave it on whatever the model produces; the model
  // already accepts a placeholder string and the caller can update it
  // later via /tx-signature once the operator surfaces the original sig.
  if (
    policy.merkle_root_hex === onchain.merkleRootHex &&
    policy.policy_data_hash_hex === onchain.policyDataHashHex
  ) {
    try {
      const updated = await applyOnchainConfirmation(policy.id, {
        tx_signature: policy.onchain_tx_signature ?? 'sync-no-tx',
        onchain_pda: onchain.policyPda,
        onchain_version: onchain.version,
        merkle_root_hex: onchain.merkleRootHex,
        policy_data_hash_hex: onchain.policyDataHashHex,
      });
      logger.info('Policy onchain state synced from chain', {
        policy_id: policy.id,
        pda: onchain.policyPda,
        version: onchain.version,
      });
      return {
        policy: updated,
        outcome: { kind: 'synced_to_registered', pda: onchain.policyPda, version: onchain.version },
      };
    } catch (err) {
      logger.warn('Sync failed during applyOnchainConfirmation', {
        policy_id: policy.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { policy, outcome: { kind: 'noop', reason: 'apply failed' } };
    }
  }

  // PDA exists but commitments differ. The operator has edited the rules
  // since the on-chain registration. The DB row is correctly 'pending'
  // but it now needs to know the existing PDA so the dashboard sends an
  // update_policy ix instead of register_policy. We back-fill onchain_pda
  // and onchain_version while leaving onchain_status='pending' and the
  // local commitments untouched, so /onchain-payload below now returns
  // operation='update'.
  if (policy.onchain_pda !== onchain.policyPda) {
    await query(
      `UPDATE policies SET
         onchain_pda = $1,
         onchain_version = $2,
         onchain_status = 'pending'
       WHERE id = $3`,
      [onchain.policyPda, onchain.version, policy.id],
    );
    logger.info('Policy onchain_pda back-filled (commitment drift)', {
      policy_id: policy.id,
      pda: onchain.policyPda,
      version: onchain.version,
    });
  }
  return {
    policy: await getPolicyById(policy.id),
    outcome: {
      kind: 'commitment_drifted',
      pda: onchain.policyPda,
      on_chain_data_hash: onchain.policyDataHashHex,
    },
  };
}
