// Runnable example: MPP off_session Stripe charge + on-chain attestation.
//
// Run from the repo root:
//
//   node --env-file=.env sdk/aperture-sdk/examples/pay-mpp.mjs
//
// Required env: SOLANA_RPC_URL, AGENT_WALLET_PRIVATE_KEY, STRIPE_SECRET_KEY,
//               and a Stripe customer + payment_method already saved against
//               this operator via the Aperture dashboard.

import { ApertureClient } from '../dist/index.js';
import { Keypair } from '@solana/web3.js';

function loadWallet() {
  const raw = process.env.AGENT_WALLET_PRIVATE_KEY;
  if (!raw) throw new Error('Set AGENT_WALLET_PRIVATE_KEY');
  let bytes;
  if (raw.trim().startsWith('[')) {
    bytes = new Uint8Array(JSON.parse(raw));
  } else {
    const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = 0n;
    for (const c of raw.trim()) n = n * 58n + BigInt(A.indexOf(c));
    const hex = n.toString(16).padStart(128, '0');
    bytes = new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
  }
  return Keypair.fromSecretKey(bytes);
}

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  throw new Error('Set STRIPE_SECRET_KEY to run the MPP example');
}

const wallet = loadWallet();
const client = new ApertureClient({
  wallet,
  rpcUrl: process.env.SOLANA_RPC_URL,
  policyServiceUrl: process.env.POLICY_SERVICE_URL ?? 'https://policy-server-production.up.railway.app',
  proverServiceUrl: process.env.PROVER_SERVICE_URL ?? 'https://prover-service-production-e486.up.railway.app',
  complianceApiUrl: process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app',
  stripeSecretKey: stripeKey,
});

console.log('operator:', client.operatorId);
const policy = await client.loadActivePolicy();
console.log('policy:', policy.id);

const endpoint = `${process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app'}/api/v1/compliance/mpp-protected-service?operator_id=${client.operatorId}`;

console.log('charging MPP endpoint:', endpoint);
const t0 = Date.now();
const result = await client.payMpp(endpoint, policy);
const elapsed = Date.now() - t0;

console.log('');
console.log('=== MPP OK in', elapsed, 'ms ===');
console.log(' tx          :', result.txSignature);
console.log(' explorer    :', `https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`);
console.log(' proof       :', result.proofRecordPda);
console.log(' paymentIntent:', result.paymentIntentId);
console.log(' amount      :', `$${(result.amountCents / 100).toFixed(2)} ${result.currency}`);
console.log(' status      :', result.response.status);
