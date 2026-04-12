/**
 * Mint a compressed attestation token and verify cost savings.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import { createRpc } from '@lightprotocol/stateless.js';
import { mintTo } from '@lightprotocol/compressed-token';
import * as fs from 'fs';
import * as path from 'path';

const HELIUS_KEY = process.env.HELIUS_API_KEY!;
const RPC_URL = `https://devnet.helius-rpc.com/?api-key=${HELIUS_KEY}`;
const COMPRESSED_MINT = new PublicKey('EraJfY2Lk1BpWHjBZuxA1T8Re36D515JLkW1FFo7Ah1P');

async function main() {
  const rpc = createRpc(RPC_URL, RPC_URL);
  const payer = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.config/solana/id.json'), 'utf-8'))
  ));

  console.log('Payer:', payer.publicKey.toBase58());
  console.log('Compressed Mint:', COMPRESSED_MINT.toBase58());

  // Get balance before
  const balBefore = await rpc.getBalance(payer.publicKey);
  console.log('Balance before:', balBefore / 1e9, 'SOL');

  // Mint 1 compressed attestation token
  console.log('\nMinting compressed attestation token...');
  try {
    const sig = await mintTo(
      rpc,
      payer,
      COMPRESSED_MINT,
      payer.publicKey,   // destination
      payer.publicKey,   // authority
      1,
    );
    console.log('Mint TX:', sig);
    console.log('Explorer:', `https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Get balance after
    const balAfter = await rpc.getBalance(payer.publicKey);
    const costLamports = balBefore - balAfter;
    console.log('\nBalance after:', balAfter / 1e9, 'SOL');
    console.log('Actual cost:', costLamports, 'lamports (', (costLamports / 1e9).toFixed(9), 'SOL)');

    // Compare with regular PDA
    const regularCost = 1_461_600; // ProofRecord rent-exempt
    console.log('\n=== Cost Comparison ===');
    console.log('Regular ProofRecord PDA:', regularCost, 'lamports (', (regularCost / 1e9).toFixed(6), 'SOL)');
    console.log('Compressed attestation:', costLamports, 'lamports (', (costLamports / 1e9).toFixed(9), 'SOL)');
    console.log('Savings:', Math.round(regularCost / costLamports) + 'x cheaper');
    console.log('Savings %:', ((1 - costLamports / regularCost) * 100).toFixed(1) + '%');
  } catch (e: any) {
    console.error('Mint failed:', e.message?.slice(0, 300));
    console.error('Stack:', e.stack?.slice(0, 500));
  }

  // Check compressed token accounts
  console.log('\nQuerying compressed token accounts...');
  try {
    const accounts = await rpc.getCompressedTokenAccountsByOwner(payer.publicKey, { mint: COMPRESSED_MINT });
    console.log('Compressed accounts:', accounts.items.length);
    let totalBalance = 0n;
    for (const a of accounts.items) {
      totalBalance += BigInt(a.parsed.amount.toString());
    }
    console.log('Total attestation tokens:', totalBalance.toString());
  } catch (e: any) {
    console.log('Query error:', e.message?.slice(0, 200));
  }
}

main().catch(console.error);
