// Policy-only demo. Creates a richly-ruled policy via the SDK, anchors it
// on-chain, then reads it back from policy-service to prove every rule
// (max_daily_spend, max_per_transaction, allowed_endpoint_categories,
// blocked_addresses, time_restrictions, token_whitelist) survives the round
// trip into Postgres + the Merkle commitment.
//
// No funding required beyond ~0.005 SOL on the wallet for the
// initialize_operator + register_policy transaction.
//
// Run from the repo root:
//   node --env-file=.env sdk/aperture-sdk/examples/create-policy.mjs
//
// To use a brand new operator wallet instead of the env wallet, set:
//   APERTURE_FRESH_WALLET=1
// and ensure your env wallet has enough SOL to fund the new wallet.

import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { ApertureClient, deriveOperatorPDA } from '../dist/index.js';

const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDT = '92rsgTRBkCt16wMXFGEujHpj4WLpixoWRkP6wrLVooSm';

function loadEnvWallet() {
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

const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
const fundedWallet = loadEnvWallet();

let wallet = fundedWallet;
if (process.env.APERTURE_FRESH_WALLET === '1') {
  wallet = Keypair.generate();
  console.log('--- Funding fresh wallet', wallet.publicKey.toBase58(), 'with 0.005 SOL');
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fundedWallet.publicKey,
      toPubkey: wallet.publicKey,
      lamports: 0.005 * 1_000_000_000,
    }),
  );
  tx.feePayer = fundedWallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(fundedWallet);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
}

const client = new ApertureClient({
  wallet,
  connection,
  policyServiceUrl: process.env.POLICY_SERVICE_URL ?? 'https://policy-server-production.up.railway.app',
  proverServiceUrl: process.env.PROVER_SERVICE_URL ?? 'https://prover-service-production-e486.up.railway.app',
  complianceApiUrl: process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app',
  ...(process.env.DASHBOARD_URL ? { dashboardUrl: process.env.DASHBOARD_URL } : {}),
  cluster: 'devnet',
});

console.log('operator wallet:', client.operatorId);

const ruleSet = {
  operator_id: client.operatorId,
  name: 'rules-demo-' + Date.now().toString(36),
  description: 'Exercises every policy rule type — read it back to verify',
  max_daily_spend: 25,
  max_per_transaction: 3,
  allowed_endpoint_categories: ['x402', 'mpp', 'api'],
  // Use real ephemeral pubkeys so they're guaranteed-valid base58. In
  // production you'd substitute these with your real sanctions list.
  blocked_addresses: [
    Keypair.generate().publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
  ],
  token_whitelist: [USDC, USDT],
  time_restrictions: [
    {
      allowed_days: [
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
        'saturday', 'sunday',
      ],
      allowed_hours_start: 0,
      allowed_hours_end: 23,
      timezone: 'UTC',
    },
  ],
  is_active: true,
};

console.log('--- Rules to register ---');
console.log(JSON.stringify(ruleSet, null, 2));

console.log('--- Creating + anchoring policy on-chain ...');
const anchor = await client.createAndAnchorPolicy(ruleSet);
console.log('policy id    :', anchor.policyId);
console.log('on-chain PDA :', anchor.onchainPda);
console.log('anchor tx    :', client.audit.explorerTx(anchor.txSignature));
console.log('operator PDA :', client.audit.explorerAccount(
  deriveOperatorPDA(wallet.publicKey)[0].toBase58(),
));

console.log('--- Reading policy back from policy-service ---');
const persisted = await client.policy.getPolicy(anchor.policyId);
console.log('name                        :', persisted.name);
console.log('version                     :', persisted.version);
console.log('onchain_status              :', persisted.onchain_status);
console.log('onchain_version             :', persisted.onchain_version);
console.log('merkle_root_hex             :', persisted.merkle_root_hex);
console.log('policy_data_hash_hex        :', persisted.policy_data_hash_hex);
console.log('max_daily_spend             :', persisted.max_daily_spend, 'USDC');
console.log('max_per_transaction         :', persisted.max_per_transaction, 'USDC');
console.log('allowed_endpoint_categories :', persisted.allowed_endpoint_categories);
console.log('token_whitelist             :', persisted.token_whitelist);
console.log('blocked_addresses           :', persisted.blocked_addresses);
console.log('time_restrictions           :', JSON.stringify(persisted.time_restrictions, null, 2));

console.log('--- Compiled view (the integer-lamport form the ZK circuit consumes) ---');
const compiled = await client.policy.compile(anchor.policyId);
console.log('max_daily_spend_lamports    :', compiled.max_daily_spend_lamports);
console.log('max_per_transaction_lamports:', compiled.max_per_transaction_lamports);
console.log('blocked_addresses           :', compiled.blocked_addresses);
console.log('token_whitelist             :', compiled.token_whitelist);
console.log('time_restrictions           :', JSON.stringify(compiled.time_restrictions));

console.log('--- Audit URL ---');
const auditUrl = client.audit.proofUrl(anchor.policyId);
if (auditUrl) {
  console.log('dashboard policy audit      :', auditUrl);
} else {
  console.log('dashboard policy audit      : (no dashboardUrl configured; set DASHBOARD_URL env to enable)');
}
