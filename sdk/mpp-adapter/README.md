# Aperture MPP Adapter

TypeScript SDK for integrating Aperture's ZK compliance proofs with the Stripe/Tempo Machine Payments Protocol (MPP). Same proof-capture flow as the x402 adapter, adapted for MPP's payment instruction format.

## Installation

```typescript
import { MPPPaymentInterceptor } from '@aperture/mpp-adapter';
```

## Usage

```typescript
const interceptor = new MPPPaymentInterceptor(
  {
    api_url: 'https://api.tempo.finance/v1',
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
  // Payment complies with policy - proceed with MPP flow
  const instruction = result.instruction;
  // Submit to MPP API
}
```

## Features

- Validates payment requests against Solana Devnet state
- Checks token balances before proof generation
- Fetches and compiles operator policies from Policy Service
- Requests ZK proofs from the Prover Service
- Builds MPP-compatible payment instructions with proof attachments
- Supports USDC and USDT on Solana Devnet
