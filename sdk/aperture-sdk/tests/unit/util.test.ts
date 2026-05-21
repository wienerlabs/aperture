import { describe, expect, it } from 'vitest';
import { hexToBytes32, sha256, base64ToBytes, toBase64Json } from '../../src/util/base.js';
import { pollUntil, sleep } from '../../src/util/poll.js';

describe('util/base', () => {
  it('sha256 matches a known fixture', () => {
    const hash = sha256('abc');
    expect(Buffer.from(hash).toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hexToBytes32 round-trips', () => {
    const hex = '00112233445566778899aabbccddeeff' + 'ffeeddccbbaa99887766554433221100';
    const bytes = hexToBytes32(hex);
    expect(Buffer.from(bytes).toString('hex')).toBe(hex);
  });

  it('hexToBytes32 rejects wrong length', () => {
    expect(() => hexToBytes32('abcd')).toThrow(/64 hex chars/);
  });

  it('hexToBytes32 rejects non-hex', () => {
    expect(() => hexToBytes32('zz'.repeat(32))).toThrow(/invalid hex/);
  });

  it('base64ToBytes decodes', () => {
    expect(Array.from(base64ToBytes('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
  });

  it('toBase64Json round-trips JSON through base64', () => {
    const encoded = toBase64Json({ a: 1, b: 'two' });
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
    expect(decoded).toEqual({ a: 1, b: 'two' });
  });
});

describe('util/poll', () => {
  it('returns the first non-null attempt', async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls += 1;
        if (calls < 3) return null;
        return 'ok';
      },
      { timeoutMs: 1_000, intervalMs: 10 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('returns null on timeout', async () => {
    const result = await pollUntil(async () => null, {
      timeoutMs: 100,
      intervalMs: 20,
    });
    expect(result).toBeNull();
  });

  it('sleep resolves', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
