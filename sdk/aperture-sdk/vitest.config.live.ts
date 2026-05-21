import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Auto-load .env from the repo root so `npm run test:live` works without
// needing the shell to source it first. CI / Docker setups that already
// inject env vars are unaffected (existing process.env entries win).
const envFile = resolve(__dirname, '../../.env');
if (existsSync(envFile)) {
  const raw = readFileSync(envFile, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Local-stack defaults — these match the docker-compose ports the rest of
// the repo uses. Override by exporting your own values before running.
process.env.POLICY_SERVICE_URL ??= 'http://localhost:3001';
process.env.COMPLIANCE_API_URL ??= 'http://localhost:3002';
process.env.PROVER_SERVICE_URL ??= 'http://localhost:3003';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // Generous timeout: a real Groth16 proof + a Solana confirmed roundtrip
    // can easily exceed Vitest's default 5 s.
    testTimeout: 600_000,
    hookTimeout: 60_000,
    // Live tests touch shared on-chain state (OperatorState.daily_spent,
    // ProofRecord PDAs) so serialize them to avoid nonce / spend races.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
