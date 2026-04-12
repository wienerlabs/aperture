# Aperture x402 Adapter

TypeScript SDK for integrating Aperture's ZK compliance proofs with the Coinbase x402 payment protocol. Intercepts AI agent payment requests, validates compliance, generates proofs, and attaches them to x402 payment headers.

## Installation

```typescript
import { X402PaymentInterceptor } from '@aperture/x402-adapter';
```

## Usage

```typescript
const interceptor = new X402PaymentInterceptor(
  {
    facilitator_url: 'https://x402.org/facilitator',
    network: 'solana-devnet',
    prover_service_url: 'http://localhost:50051',
    policy_service_url: 'http://localhost:3001',
    supported_tokens: [
      { symbol: 'USDC', mint_address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 },
      { symbol: 'USDT', mint_address: 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUQS7QEkCybt4rCxsT', decimals: 6 },
    ],
  },
  'https://api.devnet.solana.com'
);

const result = await interceptor.intercept(paymentRequest);

if (result.approved) {
  // Payment complies with policy - proceed with x402 flow
  const encodedHeader = adapter.encodePaymentHeader(result.header);
  // Attach to HTTP 402 response
}
```

## Features

- Validates payment requests against Solana Devnet state
- Checks token balances before proof generation
- Fetches and compiles operator policies from Policy Service
- Requests ZK proofs from the Prover Service
- Builds x402-compatible payment headers with embedded Aperture proofs
- Supports USDC and USDT on Solana Devnet
