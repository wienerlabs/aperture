// SDK-only onboarding example. Drives the full lifecycle from a brand-new
// Solana keypair: create policy → anchor on-chain → pay an x402 endpoint →
// roll up a batch attestation → print audit + explorer URLs. The Aperture
// dashboard is never touched.
//
// Required env:
//   SOLANA_RPC_URL                Solana RPC (devnet by default)
//   AGENT_WALLET_PRIVATE_KEY      An already-funded wallet that will seed
//                                 the freshly-minted operator with SOL+USDC.
//   POLICY_SERVICE_URL            http://localhost:3001  (docker-compose)
//   PROVER_SERVICE_URL            http://localhost:3003
//   COMPLIANCE_API_URL            http://localhost:3002
//
// Run from the repo root:
//   node --env-file=.env sdk/aperture-sdk/examples/onboard-fresh-wallet.mjs

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { ApertureClient, deriveOperatorPDA } from '../dist/index.js';

const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

function loadFunder() {
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

async function transferSol(connection, from, to, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }),
  );
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(from);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
}

async function transferUsdc(connection, from, to, lamports) {
  const fromAta = await getAssociatedTokenAddress(USDC_MINT, from.publicKey, false, TOKEN_PROGRAM_ID);
  const toAta = await getAssociatedTokenAddress(USDC_MINT, to, false, TOKEN_PROGRAM_ID);
  const tx = new Transaction();
  if (!(await connection.getAccountInfo(toAta))) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        from.publicKey,
        toAta,
        to,
        USDC_MINT,
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  tx.add(
    createTransferCheckedInstruction(
      fromAta,
      USDC_MINT,
      toAta,
      from.publicKey,
      lamports,
      6,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(from);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
}

const funder = loadFunder();
const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

// The fresh operator wallet starts empty. The funder seeds it with enough
// SOL to pay for ~4 transactions of fees + enough USDC to settle one x402
// payment plus a small headroom. The amounts here are deliberately low so
// the script can be run many times against a single Devnet faucet drop.
const FUND_SOL_LAMPORTS = 0.03 * 1_000_000_000;
const FUND_USDC_LAMPORTS = 1_500_000; // 1.5 USDC

const fresh = Keypair.generate();
console.log('--- Fresh operator wallet:', fresh.publicKey.toBase58());

const funderUsdcAta = await getAssociatedTokenAddress(
  USDC_MINT,
  funder.publicKey,
  false,
  TOKEN_PROGRAM_ID,
);
const [funderSol, funderUsdc] = await Promise.all([
  connection.getBalance(funder.publicKey),
  connection.getTokenAccountBalance(funderUsdcAta).catch(() => ({ value: { amount: '0' } })),
]);
const usdcAvailable = parseInt(funderUsdc.value.amount, 10);
if (funderSol < FUND_SOL_LAMPORTS) {
  throw new Error(
    `Funder ${funder.publicKey.toBase58()} has only ${funderSol / 1e9} SOL; needs at least ${FUND_SOL_LAMPORTS / 1e9}. Airdrop with: solana airdrop 1 ${funder.publicKey.toBase58()} --url devnet`,
  );
}
if (usdcAvailable < FUND_USDC_LAMPORTS) {
  throw new Error(
    `Funder ${funder.publicKey.toBase58()} has only ${(usdcAvailable / 1_000_000).toFixed(2)} USDC; needs at least ${FUND_USDC_LAMPORTS / 1_000_000}. Top up the funder's USDC ATA before running this example.`,
  );
}

console.log(
  `--- Funding with ${FUND_SOL_LAMPORTS / 1e9} SOL + ${FUND_USDC_LAMPORTS / 1_000_000} USDC from ${funder.publicKey.toBase58()}`,
);
await transferSol(connection, funder, fresh.publicKey, FUND_SOL_LAMPORTS);
await transferUsdc(connection, funder, fresh.publicKey, FUND_USDC_LAMPORTS);

const client = new ApertureClient({
  wallet: fresh,
  connection,
  policyServiceUrl: process.env.POLICY_SERVICE_URL ?? 'https://policy-server-production.up.railway.app',
  proverServiceUrl: process.env.PROVER_SERVICE_URL ?? 'https://prover-service-production-e486.up.railway.app',
  complianceApiUrl: process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app',
  ...(process.env.DASHBOARD_URL ? { dashboardUrl: process.env.DASHBOARD_URL } : {}),
  cluster: 'devnet',
});

console.log('--- 1. Creating policy + anchoring on-chain (single SDK call) ...');
const policyInput = {
  operator_id: client.operatorId,
  name: 'demo-' + Date.now().toString(36),
  description: 'SDK-only onboarding demo — exercises every rule type',
  max_daily_spend: 10,
  max_per_transaction: 5,
  allowed_endpoint_categories: ['x402', 'mpp', 'api'],
  // Sanctions-style blocklist. The verifier rejects payments whose recipient
  // matches any of these pubkeys. Substitute your real list in production.
  blocked_addresses: [
    Keypair.generate().publicKey.toBase58(),
    Keypair.generate().publicKey.toBase58(),
  ],
  token_whitelist: [USDC_MINT.toBase58()],
  // Time window. allowed_hours_end is inclusive (24h clock, max 23).
  // This example allows all 7 days, all 24 hours so the demo runs any time;
  // a real policy would narrow this to business hours.
  time_restrictions: [
    {
      allowed_days: [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ],
      allowed_hours_start: 0,
      allowed_hours_end: 23,
      timezone: 'UTC',
    },
  ],
  is_active: true,
};
console.log('  rules being submitted:');
console.log('    max_daily_spend             :', policyInput.max_daily_spend, 'USDC');
console.log('    max_per_transaction         :', policyInput.max_per_transaction, 'USDC');
console.log('    allowed_endpoint_categories :', policyInput.allowed_endpoint_categories.join(', '));
console.log('    token_whitelist             :', policyInput.token_whitelist.join(', '));
console.log('    blocked_addresses           :', policyInput.blocked_addresses.length, 'entries');
policyInput.blocked_addresses.forEach((a, i) =>
  console.log(`      [${i}] ${a}`),
);
console.log('    time_restrictions           :', policyInput.time_restrictions.length, 'window(s)');
policyInput.time_restrictions.forEach((t, i) =>
  console.log(
    `      [${i}] days=${t.allowed_days.join(',')} hours=${t.allowed_hours_start}-${t.allowed_hours_end} ${t.timezone}`,
  ),
);

const anchor = await client.createAndAnchorPolicy(policyInput);
console.log('  policy id   :', anchor.policyId);
console.log('  policy PDA  :', anchor.onchainPda);
console.log('  anchor tx   :', client.audit.explorerTx(anchor.txSignature));
console.log('  operator PDA:', client.audit.explorerAccount(
  deriveOperatorPDA(fresh.publicKey)[0].toBase58(),
));

// Fetch the persisted Policy row back from policy-service so we can prove
// the rules survived the round-trip into Postgres + the Merkle commitment.
const persisted = await client.policy.getPolicy(anchor.policyId);
console.log('--- 1b. Persisted policy row (read from policy-service) ---');
console.log('  name                 :', persisted.name);
console.log('  version              :', persisted.version);
console.log('  onchain_status       :', persisted.onchain_status);
console.log('  onchain_version      :', persisted.onchain_version);
console.log('  merkle_root_hex      :', persisted.merkle_root_hex);
console.log('  policy_data_hash_hex :', persisted.policy_data_hash_hex);
console.log('  blocked_addresses    :', persisted.blocked_addresses);
console.log('  token_whitelist      :', persisted.token_whitelist);
console.log('  allowed_categories   :', persisted.allowed_endpoint_categories);
console.log('  time_restrictions    :', JSON.stringify(persisted.time_restrictions));

// Compiled view that the ZK circuit will consume — lamports + canonical shape.
const compiled = await client.policy.compile(anchor.policyId);
console.log('--- 1c. Compiled policy (the form the Circom witness consumes) ---');
console.log('  max_daily_spend_lamports    :', compiled.max_daily_spend_lamports);
console.log('  max_per_transaction_lamports:', compiled.max_per_transaction_lamports);
console.log('  blocked_addresses           :', compiled.blocked_addresses);
console.log('  token_whitelist             :', compiled.token_whitelist);

console.log('--- 2. Paying an x402-protected endpoint ...');
const policy = await client.loadActivePolicy();
const endpoint = `${process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app'}/api/v1/compliance/protected-report?operator_id=${client.operatorId}`;
const pay = await client.payX402(endpoint, policy);
console.log('  paid tx     :', client.audit.explorerTx(pay.txSignature));
console.log('  unlocked    :', pay.response.status, '(merchant returned the report)');
if (pay.recording) {
  console.log('  proof row   :', pay.recording.proofRowId);
  const proofAuditUrl = client.audit.proofUrl(pay.recording.proofRowId);
  if (proofAuditUrl) {
    console.log('  audit URL   :', proofAuditUrl);
  }
}

console.log('--- 3. Rolling up a batch attestation ...');
const batch = await client.createBatchAttestation({
  periodStart: new Date(Date.now() - 5 * 60_000),
  periodEnd: new Date(),
});
console.log('  attestation :', batch.attestationId);
console.log('  batch tx    :', client.audit.explorerTx(batch.txSignature));
const batchAuditUrl = client.audit.attestationUrl(batch.attestationId);
if (batchAuditUrl) {
  console.log('  audit URL   :', batchAuditUrl);
}

console.log('');
console.log('ALL DONE. Third-party operator went from "fresh keypair" to "settled, attested, and auditable" using only the SDK.');
