import crypto from 'node:crypto';

export function sha256(data: Uint8Array | string): Uint8Array {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return new Uint8Array(crypto.createHash('sha256').update(input).digest());
}

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) {
    throw new Error(
      `hexToBytes32: expected 64 hex chars (32 bytes), got ${clean.length}`,
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes32: invalid hex at offset ${i * 2}`);
    }
    bytes[i] = byte;
  }
  return bytes;
}

export function toBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64');
}
