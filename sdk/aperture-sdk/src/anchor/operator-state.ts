import { PublicKey, type Connection } from '@solana/web3.js';
import { DISCRIMINATORS } from './constants.js';
import { deriveOperatorStatePDA, type ProgramIds } from './pda.js';

/**
 * Decoded view of the verifier program's OperatorState account.
 *
 * Layout (after the 8-byte Anchor discriminator):
 *   operator: Pubkey                 // 32 bytes
 *   daily_spent_lamports: u64        //  8 bytes LE
 *   day_start_unix: i64              //  8 bytes LE
 *   total_lifetime_payments: u64     //  8 bytes LE
 *   pending_proof_hash: [u8; 32]     // 32 bytes
 *   bump: u8                         //  1 byte
 * Total: 8 + 32 + 8 + 8 + 8 + 32 + 1 = 97 bytes
 */
export interface OperatorState {
  readonly operator: PublicKey;
  readonly dailySpentLamports: bigint;
  readonly dayStartUnix: bigint;
  readonly totalLifetimePayments: bigint;
  readonly pendingProofHash: Uint8Array;
  readonly bump: number;
}

const SECONDS_PER_DAY = 86_400n;

/**
 * Decodes raw OperatorState account data. Throws if the buffer is too short
 * or the Anchor discriminator does not match — those indicate the caller is
 * pointing at the wrong account, which would silently desync the agent's
 * daily_spent from what the verifier sees on-chain.
 */
export function decodeOperatorState(data: Uint8Array): OperatorState {
  if (data.length < 97) {
    throw new Error(
      `OperatorState account too short: ${data.length} bytes (need >= 97)`,
    );
  }
  for (let i = 0; i < 8; i++) {
    if (data[i] !== DISCRIMINATORS.operatorState[i]) {
      throw new Error('OperatorState discriminator mismatch — wrong account');
    }
  }
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return {
    operator: new PublicKey(buf.subarray(8, 40)),
    dailySpentLamports: buf.readBigUInt64LE(40),
    dayStartUnix: buf.readBigInt64LE(48),
    totalLifetimePayments: buf.readBigUInt64LE(56),
    pendingProofHash: new Uint8Array(buf.subarray(64, 96)),
    bump: buf.readUInt8(96),
  };
}

/**
 * Reads the OperatorState PDA for an operator. Returns null when the account
 * does not yet exist — the verifier treats that as "0 USDC spent today" on
 * its first invocation, so callers should as well.
 */
export async function readOperatorState(
  connection: Connection,
  operator: PublicKey,
  programs?: ProgramIds,
): Promise<OperatorState | null> {
  const [pda] = deriveOperatorStatePDA(operator, programs);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return decodeOperatorState(info.data);
}

/**
 * Returns the daily-spent value the ZK circuit must consume as its
 * `daily_spent_before` public input. Mirrors the verifier's UTC-midnight
 * rollover rule so the proof's public input matches what the verifier
 * recomputes on-chain at submit time.
 *
 * If `nowUnixSeconds` is omitted, the current wall-clock is used; callers may
 * pass a pinned value to keep the proof and the submit transaction consistent
 * across slow networks.
 */
export async function readEffectiveDailySpentLamports(
  connection: Connection,
  operator: PublicKey,
  programs?: ProgramIds,
  nowUnixSeconds?: number,
): Promise<bigint> {
  const state = await readOperatorState(connection, operator, programs);
  if (!state) return 0n;
  const now = BigInt(nowUnixSeconds ?? Math.floor(Date.now() / 1000));
  const todayStart = now - (now % SECONDS_PER_DAY);
  return todayStart > state.dayStartUnix ? 0n : state.dailySpentLamports;
}
