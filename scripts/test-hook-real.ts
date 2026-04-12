/**
 * Test transfer hook with real different-account transfer
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
const RECIPIENT = new PublicKey('2jcWr2gtGVePDPzJPQohibjsQbsfjdKuyHuGAnRyvSWu');

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  const keypairPath = path.join(process.env.HOME!, '.config', 'solana', 'id.json');
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')))
  );

  const senderAta = getAssociatedTokenAddressSync(VUSDC_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const recipientAta = getAssociatedTokenAddressSync(VUSDC_MINT, RECIPIENT, false, TOKEN_2022_PROGRAM_ID);

  console.log('Sender:', wallet.publicKey.toBase58());
  console.log('Sender ATA:', senderAta.toBase58());
  console.log('Recipient:', RECIPIENT.toBase58());
  console.log('Recipient ATA:', recipientAta.toBase58());

  // Transfer to different account - should trigger hook
  console.log('\n=== Transfer to different account (should trigger hook) ===');
  const ix = await createTransferCheckedWithTransferHookInstruction(
    connection,
    senderAta,
    VUSDC_MINT,
    recipientAta,
    wallet.publicKey,
    BigInt(1_000_000), // 1 vUSDC
    6,
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID
  );

  console.log('Instruction keys:', ix.keys.length);
  ix.keys.forEach((k, i) => console.log(`  ${i}: ${k.pubkey.toBase58().slice(0,12)}...`));

  // Simulate first
  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  try {
    const sim = await connection.simulateTransaction(tx, [wallet]);
    console.log('\nSimulation error:', sim.value.err);
    console.log('CU consumed:', sim.value.unitsConsumed);
    sim.value.logs?.forEach(l => console.log('  ', l));

    if (!sim.value.err) {
      // Send for real
      const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('\nTX:', sig);
      console.log('Explorer:', explorerTx(sig));
    }
  } catch (err: any) {
    console.log('Error:', err.message?.slice(0, 300));
    const logs = err.transactionLogs || [];
    logs.forEach((l: string) => console.log('  ', l));
  }
}

main().catch(console.error);
