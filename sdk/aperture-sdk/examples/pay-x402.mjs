// Runnable example: load policy → generate Groth16 proof → submit x402.
//
// Run from the repo root (so it picks up .env automatically):
//
//   node --env-file=.env sdk/aperture-sdk/examples/pay-x402.mjs
//
// Required env: SOLANA_RPC_URL, AGENT_WALLET_PRIVATE_KEY, plus
//               POLICY_SERVICE_URL / PROVER_SERVICE_URL / COMPLIANCE_API_URL
//               (defaults point at the docker-compose stack on localhost).

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

const wallet = loadWallet();
const client = new ApertureClient({
  wallet,
  rpcUrl: process.env.SOLANA_RPC_URL,
  policyServiceUrl: process.env.POLICY_SERVICE_URL ?? 'https://policy-server-production.up.railway.app',
  proverServiceUrl: process.env.PROVER_SERVICE_URL ?? 'https://prover-service-production-e486.up.railway.app',
  complianceApiUrl: process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app',
});

console.log('operator:', client.operatorId);
console.log('loading policy...');
const policy = await client.loadActivePolicy();
console.log(' policy id:', policy.id);
console.log(' onchain pda:', policy.onchainPda);
console.log(' max per tx:', policy.maxPerTxLamports / 1_000_000, 'USDC');
console.log(' whitelisted tokens:', policy.tokenWhitelist.length);

const endpoint =
  process.env.APERTURE_TEST_X402_ENDPOINT ??
  `${process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app'}/api/v1/compliance/protected-report?operator_id=${client.operatorId}`;

console.log('paying x402 endpoint:', endpoint);
const t0 = Date.now();
const result = await client.payX402(endpoint, policy);
const elapsed = Date.now() - t0;

console.log('');
console.log('=== x402 OK in', elapsed, 'ms ===');
console.log(' tx     :', result.txSignature);
console.log(' explorer:', `https://explorer.solana.com/tx/${result.txSignature}?cluster=devnet`);
console.log(' proof  :', result.proofRecordPda);
console.log(' amount :', result.amountLamports, '(', result.amountLamports / 1_000_000, 'USDC )');
console.log(' to     :', result.recipient);
console.log(' mint   :', result.tokenMint);
console.log(' status :', result.response.status);
const body = await result.response.json();
console.log(' body   :', JSON.stringify(body).slice(0, 300));
