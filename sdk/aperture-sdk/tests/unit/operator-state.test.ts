import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  DISCRIMINATORS,
  decodeOperatorState,
} from '../../src/anchor/index.js';

function buildOperatorStateAccount(opts: {
  operator: Keypair;
  dailySpentLamports: bigint;
  dayStartUnix: bigint;
  totalLifetimePayments: bigint;
  pendingProofHash?: Uint8Array;
  bump?: number;
}): Uint8Array {
  const buf = Buffer.alloc(97);
  let offset = 0;
  Buffer.from(DISCRIMINATORS.operatorState).copy(buf, offset);
  offset += 8;
  Buffer.from(opts.operator.publicKey.toBuffer()).copy(buf, offset);
  offset += 32;
  buf.writeBigUInt64LE(opts.dailySpentLamports, offset);
  offset += 8;
  buf.writeBigInt64LE(opts.dayStartUnix, offset);
  offset += 8;
  buf.writeBigUInt64LE(opts.totalLifetimePayments, offset);
  offset += 8;
  (opts.pendingProofHash ?? Buffer.alloc(32)).forEach((byte, idx) => {
    buf[offset + idx] = byte;
  });
  offset += 32;
  buf.writeUInt8(opts.bump ?? 255, offset);
  return new Uint8Array(buf);
}

describe('decodeOperatorState', () => {
  it('decodes a well-formed account', () => {
    const operator = Keypair.generate();
    const account = buildOperatorStateAccount({
      operator,
      dailySpentLamports: 750_000n,
      dayStartUnix: 1_700_000_000n,
      totalLifetimePayments: 42n,
      pendingProofHash: new Uint8Array(32).fill(9),
      bump: 254,
    });

    const decoded = decodeOperatorState(account);
    expect(decoded.operator.equals(operator.publicKey)).toBe(true);
    expect(decoded.dailySpentLamports).toBe(750_000n);
    expect(decoded.dayStartUnix).toBe(1_700_000_000n);
    expect(decoded.totalLifetimePayments).toBe(42n);
    expect(Array.from(decoded.pendingProofHash)).toEqual(
      Array.from(new Uint8Array(32).fill(9)),
    );
    expect(decoded.bump).toBe(254);
  });

  it('throws on short buffer', () => {
    expect(() => decodeOperatorState(new Uint8Array(50))).toThrow(/too short/);
  });

  it('throws on wrong discriminator', () => {
    const buf = new Uint8Array(97);
    expect(() => decodeOperatorState(buf)).toThrow(/discriminator mismatch/);
  });
});
