import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default test run = pure unit tests (no I/O, no env). Live tests
    // against real services and Solana devnet live in tests/integration/
    // and run via `npm run test:live` so CI can split fast checks from
    // network-dependent ones.
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
