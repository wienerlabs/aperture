/**
 * Debug transfer hook invocation
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createTransferCheckedWithTransferHookInstruction,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';
const VUSDC_MINT = new PublicKey('GWVArRuvRt5t6tcBTMKT27SornozssMfLzc2Eqr3XdvX');

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  const keypairPath = path.join(process.env.HOME!, '.config', 'solana', 'id.json');
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')))
  );

  const senderAta = getAssociatedTokenAddressSync(
    VUSDC_MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  console.log('Building transfer with hook instruction...');
  const ix = await createTransferCheckedWithTransferHookInstruction(
    connection,
    senderAta,
    VUSDC_MINT,
    senderAta,
    wallet.publicKey,
    BigInt(1_000_000),
    6,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log('Instruction program:', ix.programId.toBase58());
  console.log('Number of keys:', ix.keys.length);
  for (let i = 0; i < ix.keys.length; i++) {
    console.log(`  Key ${i}: ${ix.keys[i].pubkey.toBase58()} (signer: ${ix.keys[i].isSigner}, writable: ${ix.keys[i].isWritable})`);
  }
  console.log('Data hex:', Buffer.from(ix.data).toString('hex').slice(0, 40) + '...');

  // Simulate to see logs
  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  try {
    const sim = await connection.simulateTransaction(tx, [wallet]);
    console.log('\nSimulation result:');
    console.log('Error:', sim.value.err);
    console.log('Logs:');
    sim.value.logs?.forEach(l => console.log('  ', l));
  } catch (err: any) {
    console.log('Simulation error:', err.message?.slice(0, 200));
  }
}

main().catch(console.error);
