/**
 * Adım 9 — Address Lookup Table for x402 transactions.
 *
 * The verify_payment_proof_v2 + transferCheckedWithTransferHook bundle
 * serializes at ~1236 bytes — 4 over the legacy 1232-byte cap and even
 * ~5 over the V0 cap. Putting the static program IDs into an ALT shaves
 * 5 * 31 = 155 bytes (each pubkey collapses from 32 bytes to a 1-byte
 * lookup index), bringing the tx well under the limit.
 *
 * This script is run once per cluster (devnet / mainnet). It writes the
 * resulting ALT pubkey to scripts/deploy/x402-lookup-table.json so the
 * agent + dashboard can fetch it at runtime without a config endpoint.
 *
 * Run with:
 *   tsx scripts/setup-x402-alt.ts \
 *     --keypair scripts/deploy/aperture-treasury.json \
 *     --rpc https://api.devnet.solana.com
 */
import {
  Connection,
  Keypair,
  AddressLookupTableProgram,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'node:fs';
import * as path from 'node:path';

const VERIFIER_PROGRAM = new PublicKey('AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU');
const POLICY_REGISTRY_PROGRAM = new PublicKey('FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU');
const TRANSFER_HOOK_PROGRAM = new PublicKey('3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt');

// IMPORTANT: Token-2022 and the ATA program are deliberately excluded.
// Token-2022's transfer-hook resolution path (extra-account-meta-list +
// hook program CPI) does NOT work when Token-2022's own program ID is
// resolved via an ALT under MessageV0 — the runtime returns
// `Error: Unknown` (custom 0xa261c2c0) before the hook is even invoked.
// Keeping these two as static account keys means the savings come purely
// from Aperture's own Anchor program ids + the System program.
const ENTRIES = [
  VERIFIER_PROGRAM,
  POLICY_REGISTRY_PROGRAM,
  TRANSFER_HOOK_PROGRAM,
  SystemProgram.programId,
];

function parseArgs(): { keypair: string | null; bs58Key: string | null; rpc: string } {
  const args = process.argv.slice(2);
  let keypair: string | null = null;
  let bs58Key: string | null = null;
  let rpc = 'https://api.devnet.solana.com';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keypair' && args[i + 1]) keypair = args[++i];
    else if (args[i] === '--bs58' && args[i + 1]) bs58Key = args[++i];
    else if (args[i] === '--rpc' && args[i + 1]) rpc = args[++i];
  }
  if (!keypair && !bs58Key) {
    keypair = 'scripts/deploy/aperture-treasury.json';
  }
  return { keypair, bs58Key, rpc };
}

async function main() {
  const { keypair: keypairPath, bs58Key, rpc } = parseArgs();
  let payer: Keypair;
  if (bs58Key) {
    const bs58 = (await import('bs58')).default;
    payer = Keypair.fromSecretKey(bs58.decode(bs58Key));
  } else {
    const keypairJson = JSON.parse(fs.readFileSync(keypairPath!, 'utf-8')) as number[];
    payer = Keypair.fromSecretKey(new Uint8Array(keypairJson));
  }
  const connection = new Connection(rpc, 'confirmed');

  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 0.005 * 1e9) {
    throw new Error('Need at least ~0.005 SOL for ALT rent + fees. Run `solana airdrop 0.5` or fund the keypair.');
  }

  // 1. Create the ALT
  const slot = await connection.getSlot('finalized');
  const [createIx, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  console.log(`ALT pubkey: ${lookupTableAddress.toBase58()}`);

  // 2. Extend it with the static program IDs
  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses: ENTRIES,
  });

  const tx = new Transaction().add(createIx, extendIx);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(payer);

  console.log('Sending tx...');
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`Confirmed: ${sig}`);

  // 3. ALT needs ~1 slot to activate; wait a beat
  console.log('Waiting 2s for ALT activation...');
  await new Promise((r) => setTimeout(r, 2000));

  // 4. Persist
  const outPath = path.resolve('scripts/deploy/x402-lookup-table.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        cluster: rpc,
        lookupTable: lookupTableAddress.toBase58(),
        addresses: ENTRIES.map((p) => p.toBase58()),
        createdAt: new Date().toISOString(),
        txSignature: sig,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
