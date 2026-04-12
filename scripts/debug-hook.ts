import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const VUSDC = new PublicKey('GWVArRuvRt5t6tcBTMKT27SornozssMfLzc2Eqr3XdvX');
const VERIFIER = new PublicKey('HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr');
const RECIPIENT = new PublicKey('2jcWr2gtGVePDPzJPQohibjsQbsfjdKuyHuGAnRyvSWu');

async function main() {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.config/solana/id.json'), 'utf-8'))));
  const senderAta = getAssociatedTokenAddressSync(VUSDC, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const recipientAta = getAssociatedTokenAddressSync(VUSDC, RECIPIENT, false, TOKEN_2022_PROGRAM_ID);

  // Find the most recent proof PDA from on-chain
  // List all accounts owned by verifier to find a ProofRecord for our wallet
  const accounts = await conn.getProgramAccounts(VERIFIER, {
    filters: [
      { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } }, // operator at offset 8
    ],
  });
  console.log('Found', accounts.length, 'ProofRecord accounts for wallet');
  const proofPDA = accounts.length > 0 ? accounts[0].pubkey : null;
  if (proofPDA) {
    console.log('Using ProofRecord:', proofPDA.toBase58());
    const data = accounts[0].account.data;
    console.log('  data.len:', data.length, 'verified:', data[176] === 1);
  }

  // Build transfer with hook
  const ix = await createTransferCheckedWithTransferHookInstruction(
    conn, senderAta, VUSDC, recipientAta, wallet.publicKey,
    BigInt(1_000_000), 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
  );

  if (proofPDA) {
    // Insert proofPDA BEFORE the hook program (index 6) so Token-2022 CPI includes it
    // Token-2022 only forwards accounts up to and including the hook program ID
    ix.keys.splice(6, 0, { pubkey: proofPDA, isSigner: false, isWritable: false });
  }

  console.log('Total keys in instruction:', ix.keys.length);
  ix.keys.forEach((k, i) => console.log(`  ${i}: ${k.pubkey.toBase58()}`));

  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  const sim = await conn.simulateTransaction(tx, [wallet]);
  console.log('\nError:', JSON.stringify(sim.value.err));
  console.log('CU:', sim.value.unitsConsumed);
  sim.value.logs?.forEach(l => console.log(l));
}

main().catch(console.error);
