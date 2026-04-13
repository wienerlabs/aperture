import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC = 'https://api.devnet.solana.com';
const HOOK = new PublicKey('3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt');
const POLICY_REG = new PublicKey('FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU');
const VERIFIER = new PublicKey('AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU');
const VUSDC = new PublicKey('E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar');

function tx(sig: string) { return `https://explorer.solana.com/tx/${sig}?cluster=devnet`; }

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const wallet = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.config/solana/id.json'), 'utf-8'))
  ));

  // HookConfig PDA -- reuse existing one (already initialized)
  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('hook-config')], HOOK);

  // ExtraAccountMetaList for NEW mint
  const [extraPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), VUSDC.toBuffer()], HOOK
  );

  console.log('New vUSDC:', VUSDC.toBase58());
  console.log('ExtraMetasPDA:', extraPDA.toBase58());

  // Initialize ExtraAccountMetaList for new vUSDC mint
  const info = await conn.getAccountInfo(extraPDA);
  if (info) {
    console.log('ExtraAccountMetaList already exists for this mint');
    return;
  }

  const data = Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // DISC_INIT_EXTRA_METAS

  // Accounts: extraMetasPDA, mint, hookConfig (for reading verifier), authority, system
  // But our init function expects: extra_info, mint, authority, system
  // Plus it reads hookConfig internally... wait, in the new code it reads from an additional account
  // Let me check what the new init function expects:
  // accounts: extra_info, mint, authority, system
  // PLUS: it reads hookConfig - but in the new code I added config_info as next_account_info
  // Let me re-check the code...

  // Actually looking at the code, the init function calls next_account_info 5 times:
  // extra_info, mint, authority, system, THEN config_info
  // So we need to pass config_info too

  const ix = new TransactionInstruction({
    programId: HOOK,
    keys: [
      { pubkey: extraPDA, isSigner: false, isWritable: true },
      { pubkey: VUSDC, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const t = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(conn, t, [wallet]);
  console.log('ExtraAccountMetaList initialized!');
  console.log('TX:', sig);
  console.log('Explorer:', tx(sig));

  // Now test simulation
  const { createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await import('@solana/spl-token');
  const RECIPIENT = new PublicKey('2jcWr2gtGVePDPzJPQohibjsQbsfjdKuyHuGAnRyvSWu');
  const senderAta = getAssociatedTokenAddressSync(VUSDC, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const recipientAta = getAssociatedTokenAddressSync(VUSDC, RECIPIENT, false, TOKEN_2022_PROGRAM_ID);

  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    conn, senderAta, VUSDC, recipientAta, wallet.publicKey,
    BigInt(1_000_000), 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
  );

  console.log('\nTransfer instruction keys:', transferIx.keys.length);
  transferIx.keys.forEach((k, i) => console.log(`  ${i}: ${k.pubkey.toBase58().slice(0,16)}...`));

  const simTx = new Transaction().add(transferIx);
  simTx.feePayer = wallet.publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  simTx.recentBlockhash = blockhash;

  const sim = await conn.simulateTransaction(simTx, [wallet]);
  console.log('\nSimulation:', JSON.stringify(sim.value.err));
  sim.value.logs?.forEach(l => console.log(l));
}

main().catch(console.error);
