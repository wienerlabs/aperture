// Interactive policy CLI. Prompts the operator for every rule, validates
// each answer, then creates + on-chain-anchors the policy through the SDK.
// No defaults, no placeholders, no hardcoded values — everything comes from
// the user at runtime.
//
// Run from the repo root:
//   node --env-file=.env sdk/aperture-sdk/examples/policy-cli.mjs
//
// Required env:
//   SOLANA_RPC_URL                Solana RPC.
//   AGENT_WALLET_PRIVATE_KEY      Wallet that signs initialize_operator +
//                                 register_policy (must hold ~0.005 SOL).
//   POLICY_SERVICE_URL            http://localhost:3001 (docker-compose)
//   PROVER_SERVICE_URL            http://localhost:3003
//   COMPLIANCE_API_URL            http://localhost:3002

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ApertureClient, deriveOperatorPDA } from '../dist/index.js';

const VALID_DAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const rl = readline.createInterface({ input, output });

async function ask(question) {
  const answer = await rl.question(question);
  return answer.trim();
}

async function askRequired(question, validator, errorHint) {
  while (true) {
    const raw = await ask(question);
    if (!raw) {
      console.log('  ! Value is required.');
      continue;
    }
    try {
      return validator(raw);
    } catch (err) {
      console.log(`  ! ${err instanceof Error ? err.message : String(err)}${errorHint ? '\n    ' + errorHint : ''}`);
    }
  }
}

async function askOptional(question, validator) {
  const raw = await ask(question);
  if (!raw) return null;
  try {
    return validator(raw);
  } catch (err) {
    console.log(`  ! ${err instanceof Error ? err.message : String(err)} (skipping)`);
    return null;
  }
}

async function askListRequired(question, validateEach) {
  while (true) {
    const raw = await ask(question);
    if (!raw) {
      console.log('  ! At least one value is required.');
      continue;
    }
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) {
      console.log('  ! At least one value is required.');
      continue;
    }
    try {
      return parts.map(validateEach);
    } catch (err) {
      console.log(`  ! ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function askListOptional(question, validateEach) {
  const raw = await ask(question);
  if (!raw) return [];
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  try {
    return parts.map(validateEach);
  } catch (err) {
    console.log(`  ! ${err instanceof Error ? err.message : String(err)} — none recorded`);
    return [];
  }
}

function parsePositiveNumber(label) {
  return (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${label} must be a positive number`);
    }
    return n;
  };
}

function parsePubkey(raw) {
  try {
    new PublicKey(raw);
    return raw;
  } catch {
    throw new Error(`"${raw}" is not a valid Solana address`);
  }
}

function parseCategory(raw) {
  if (!raw.match(/^[a-zA-Z0-9_-]+$/)) {
    throw new Error(`"${raw}" is not a valid category name (alphanumeric + _ -)`);
  }
  return raw;
}

function parseDay(raw) {
  const lower = raw.toLowerCase();
  if (!VALID_DAYS.has(lower)) {
    throw new Error(`"${raw}" is not a valid day name (mon-sun, full lowercase)`);
  }
  return lower;
}

function parseHour(label) {
  return (raw) => {
    const n = parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 0 || n > 23) {
      throw new Error(`${label} must be an integer between 0 and 23`);
    }
    return n;
  };
}

function loadWallet() {
  const raw = process.env.AGENT_WALLET_PRIVATE_KEY;
  if (!raw) throw new Error('Set AGENT_WALLET_PRIVATE_KEY in your env');
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

try {
  const wallet = loadWallet();
  const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');
  const client = new ApertureClient({
    wallet,
    connection,
    policyServiceUrl: process.env.POLICY_SERVICE_URL ?? 'https://policy-server-production.up.railway.app',
    proverServiceUrl: process.env.PROVER_SERVICE_URL ?? 'https://prover-service-production-e486.up.railway.app',
    complianceApiUrl: process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app',
    ...(process.env.DASHBOARD_URL ? { dashboardUrl: process.env.DASHBOARD_URL } : {}),
    cluster: 'devnet',
  });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Aperture Policy CLI');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Operator wallet:', client.operatorId);
  console.log('');
  console.log('You will be asked for every policy rule. There are no defaults.');
  console.log('');

  // -------- 1. policy metadata --------
  const name = await askRequired(
    'Policy name (short identifier, e.g. "my-prod-agent"): ',
    (raw) => {
      if (raw.length < 1 || raw.length > 64) {
        throw new Error('name must be between 1 and 64 characters');
      }
      return raw;
    },
  );

  const description = await ask('Description (optional, press Enter to skip): ');

  // -------- 2. spending limits --------
  const maxDailySpend = await askRequired(
    'Max daily spend in USDC (e.g. 50): ',
    parsePositiveNumber('max_daily_spend'),
  );

  const maxPerTransaction = await askRequired(
    'Max per transaction in USDC (e.g. 5): ',
    parsePositiveNumber('max_per_transaction'),
    'Must be <= max_daily_spend or the daily ceiling is meaningless.',
  );

  if (maxPerTransaction > maxDailySpend) {
    console.log(
      `  ! Warning: max_per_transaction (${maxPerTransaction}) is greater than max_daily_spend (${maxDailySpend}). The verifier will reject any payment.`,
    );
  }

  // -------- 3. categories --------
  const allowedCategories = await askListRequired(
    'Allowed endpoint categories (comma-separated, e.g. "x402,mpp,api"): ',
    parseCategory,
  );

  // -------- 4. token whitelist --------
  console.log('');
  console.log('Token whitelist — mints the agent is allowed to spend.');
  console.log('  Devnet USDC: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
  console.log('  Devnet USDT: 92rsgTRBkCt16wMXFGEujHpj4WLpixoWRkP6wrLVooSm');
  const tokenWhitelist = await askListRequired(
    'Whitelisted token mints (comma-separated base58 pubkeys): ',
    parsePubkey,
  );

  // -------- 5. blocked addresses --------
  const blockedAddresses = await askListOptional(
    'Blocked recipient addresses (comma-separated, leave empty for none): ',
    parsePubkey,
  );

  // -------- 6. time restrictions --------
  console.log('');
  console.log('Time restriction window:');
  const allowedDays = await askListRequired(
    'Allowed days (comma-separated, e.g. "monday,tuesday,wednesday,thursday,friday"): ',
    parseDay,
  );
  const allowedHoursStart = await askRequired(
    'Allowed hours start (0-23, e.g. 9 for 9am): ',
    parseHour('allowed_hours_start'),
  );
  let allowedHoursEnd;
  while (true) {
    allowedHoursEnd = await askRequired(
      'Allowed hours end (0-23 inclusive, e.g. 17 for 5pm): ',
      parseHour('allowed_hours_end'),
    );
    if (allowedHoursEnd >= allowedHoursStart) break;
    console.log(
      `  ! allowed_hours_end (${allowedHoursEnd}) must be >= allowed_hours_start (${allowedHoursStart}). Re-enter end hour.`,
    );
  }
  const timezone = await askRequired(
    'Timezone (currently only "UTC" is supported by the ZK circuit): ',
    (raw) => {
      if (raw !== 'UTC') {
        throw new Error('Only "UTC" is supported in the current circuit');
      }
      return raw;
    },
  );

  // -------- 7. confirm --------
  const policyInput = {
    operator_id: client.operatorId,
    name,
    ...(description ? { description } : {}),
    max_daily_spend: maxDailySpend,
    max_per_transaction: maxPerTransaction,
    allowed_endpoint_categories: allowedCategories,
    token_whitelist: tokenWhitelist,
    blocked_addresses: blockedAddresses,
    time_restrictions: [
      {
        allowed_days: allowedDays,
        allowed_hours_start: allowedHoursStart,
        allowed_hours_end: allowedHoursEnd,
        timezone,
      },
    ],
    is_active: true,
  };

  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('  Policy to register');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(JSON.stringify(policyInput, null, 2));
  console.log('───────────────────────────────────────────────────────────────');

  const confirm = await ask('Proceed? (y/N): ');
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    console.log('Aborted.');
    process.exit(0);
  }

  // -------- 8. create + anchor --------
  console.log('');
  console.log('→ Creating policy on policy-service...');
  const policy = await client.policy.createPolicy(policyInput);
  console.log(`  ✓ policy id: ${policy.id}`);
  console.log(`  ✓ merkle_root_hex: ${policy.merkle_root_hex}`);
  console.log(`  ✓ policy_data_hash_hex: ${policy.policy_data_hash_hex}`);

  console.log('');
  console.log('→ Anchoring on-chain (initialize_operator + register_policy)...');
  const anchor = await client.operator.anchorPolicy(policy.id);
  console.log(`  ✓ on-chain PDA: ${anchor.onchainPda}`);
  console.log(`  ✓ anchor tx   : ${client.audit.explorerTx(anchor.txSignature)}`);
  console.log(`  ✓ operator PDA: ${client.audit.explorerAccount(
    deriveOperatorPDA(wallet.publicKey)[0].toBase58(),
  )}`);

  // -------- 9. read it back --------
  console.log('');
  console.log('→ Reading the persisted policy back from policy-service...');
  const persisted = await client.policy.getPolicy(policy.id);
  console.log(`  name                        : ${persisted.name}`);
  console.log(`  version                     : ${persisted.version}`);
  console.log(`  onchain_status              : ${persisted.onchain_status}`);
  console.log(`  onchain_version             : ${persisted.onchain_version}`);
  console.log(`  max_daily_spend             : ${persisted.max_daily_spend} USDC`);
  console.log(`  max_per_transaction         : ${persisted.max_per_transaction} USDC`);
  console.log(`  allowed_endpoint_categories : ${persisted.allowed_endpoint_categories.join(', ')}`);
  console.log(`  token_whitelist             : ${persisted.token_whitelist.join(', ')}`);
  console.log(`  blocked_addresses (${persisted.blocked_addresses.length})       :`);
  persisted.blocked_addresses.forEach((a, i) => console.log(`    [${i}] ${a}`));
  console.log(`  time_restrictions           : ${JSON.stringify(persisted.time_restrictions)}`);

  // -------- 10. optionally test x402 --------
  console.log('');
  const testPay = await ask('Test an x402 payment against this policy now? (y/N): ');
  if (testPay.toLowerCase() === 'y' || testPay.toLowerCase() === 'yes') {
    const endpointDefault = `${process.env.COMPLIANCE_API_URL ?? 'https://compliance-api-production-21f4.up.railway.app'}/api/v1/compliance/protected-report?operator_id=${client.operatorId}`;
    let url;
    while (true) {
      const raw = await ask(
        `x402 endpoint URL (press Enter for default: ${endpointDefault}): `,
      );
      if (!raw) {
        url = endpointDefault;
        break;
      }
      try {
        new URL(raw);
        url = raw;
        break;
      } catch {
        console.log(
          `  ! "${raw}" is not a valid URL. Paste a full http(s):// URL, or press Enter to use the default.`,
        );
      }
    }
    console.log(`→ Paying ${url} ...`);
    const loaded = await client.loadActivePolicy();
    const pay = await client.payX402(url, loaded);
    console.log(`  ✓ tx          : ${client.audit.explorerTx(pay.txSignature)}`);
    console.log(`  ✓ amount      : ${pay.amountLamports / 1_000_000} USDC`);
    console.log(`  ✓ unlocked    : HTTP ${pay.response.status}`);
    if (pay.recording) {
      console.log(`  ✓ proof row   : ${pay.recording.proofRowId}`);
      const auditUrl = client.audit.proofUrl(pay.recording.proofRowId);
      if (auditUrl) console.log(`  ✓ audit URL   : ${auditUrl}`);
    }
  }

  console.log('');
  console.log('Done.');
} catch (err) {
  console.error('');
  console.error('ERROR:', err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split('\n').slice(1, 4).join('\n'));
  }
  process.exitCode = 1;
} finally {
  rl.close();
}
