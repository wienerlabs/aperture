/**
 * Create a compressed attestation mint using Light Protocol.
 * Each compressed token = 1 compliance attestation proof record.
 *
 * Requires: Helius API key for ZK Compression RPC
 * Usage: HELIUS_API_KEY=xxx npx tsx scripts/create-compressed-mint.ts
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { createRpc } from '@lightprotocol/stateless.js';
import { createMint, mintTo } from '@lightprotocol/compressed-token';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    console.error('Set HELIUS_API_KEY environment variable');
    console.error('Get a free key at https://dev.helius.xyz');
    process.exit(1);
  }

  const rpcUrl = `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
  const rpc = createRpc(rpcUrl, rpcUrl);

  // Load deployer keypair
  const keypairPath = path.join(process.env.HOME!, '.config', 'solana', 'id.json');
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')))
  );
  console.log('Payer:', payer.publicKey.toBase58());

  const balance = await rpc.getBalance(payer.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL');

  // Create compressed mint (decimals=0, each token = 1 attestation)
  console.log('\nCreating compressed attestation mint...');
  const { mint, transactionSignature } = await createMint(
    rpc,
    payer,          // payer
    payer.publicKey, // mint authority
    0               // decimals (0 = NFT-like, 1 token = 1 attestation)
  );

  console.log('Compressed Attestation Mint:', mint.toBase58());
  console.log('TX:', transactionSignature);
  console.log('Explorer:', `https://explorer.solana.com/tx/${transactionSignature}?cluster=devnet`);

  // Test: mint 1 attestation token to ourselves
  console.log('\nMinting 1 test attestation...');
  const mintTxSig = await mintTo(
    rpc,
    payer,           // payer
    mint,            // mint
    payer.publicKey,  // destination owner
    payer.publicKey,  // mint authority
    1,               // amount (1 attestation)
  );

  console.log('Test mint TX:', mintTxSig);
  console.log('Explorer:', `https://explorer.solana.com/tx/${mintTxSig}?cluster=devnet`);

  // Check compressed token balance
  const accounts = await rpc.getCompressedTokenAccountsByOwner(payer.publicKey, { mint });
  console.log('\nCompressed token accounts:', accounts.items.length);
  if (accounts.items.length > 0) {
    console.log('Balance:', accounts.items[0].parsed.amount.toString());
  }

  console.log('\n=== Add to .env ===');
  console.log(`NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT=${mint.toBase58()}`);
  console.log(`NEXT_PUBLIC_LIGHT_RPC_URL=${rpcUrl}`);
}

main().catch(console.error);
