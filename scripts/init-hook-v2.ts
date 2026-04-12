/**
 * Initialize HookConfig + ExtraAccountMetaList for the pure SDK transfer hook.
 * Uses the new discriminators (DISC_INIT_CONFIG = [1,0,0,0,0,0,0,0], DISC_INIT_EXTRA = [2,0,0,0,0,0,0,0]).
 */
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC = 'https://api.devnet.solana.com';
const HOOK = new PublicKey('3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt');
const POLICY_REG = new PublicKey('CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs');
const VERIFIER = new PublicKey('HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr');
const VUSDC = new PublicKey('GWVArRuvRt5t6tcBTMKT27SornozssMfLzc2Eqr3XdvX');

const DISC_INIT_CONFIG = Buffer.from([1,0,0,0,0,0,0,0]);
const DISC_INIT_EXTRA = Buffer.from([2,0,0,0,0,0,0,0]);

function explorerTx(sig: string) { return `https://explorer.solana.com/tx/${sig}?cluster=devnet`; }

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const wallet = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.config/solana/id.json'), 'utf-8'))
  ));

  const [configPDA] = PublicKey.findProgramAddressSync([Buffer.from('hook-config')], HOOK);
  const [extraPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), VUSDC.toBuffer()], HOOK
  );

  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('HookConfig PDA:', configPDA.toBase58());
  console.log('ExtraAccountMetas PDA:', extraPDA.toBase58());

  // Check if old accounts exist and close them if needed
  const configInfo = await conn.getAccountInfo(configPDA);
  const extraInfo = await conn.getAccountInfo(extraPDA);

  if (configInfo) {
    console.log('\nHookConfig already exists (old format). Will try to initialize anyway...');
    // Old account exists with different format - we need to reinitialize
    // Since it's a PDA owned by our program, the new program can overwrite it
  }

  // Step 1: Initialize HookConfig
  if (!configInfo) {
    console.log('\n--- Initialize HookConfig ---');
    const data = Buffer.alloc(8 + 32 + 32);
    DISC_INIT_CONFIG.copy(data, 0);
    POLICY_REG.toBuffer().copy(data, 8);
    VERIFIER.toBuffer().copy(data, 40);

    const ix = new TransactionInstruction({
      programId: HOOK,
      keys: [
        { pubkey: configPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [wallet]);
    console.log('HookConfig TX:', sig);
    console.log('Explorer:', explorerTx(sig));
  } else {
    console.log('HookConfig exists, skipping create');
  }

  // Step 2: Initialize ExtraAccountMetaList
  if (!extraInfo) {
    console.log('\n--- Initialize ExtraAccountMetaList ---');
    const data = Buffer.from(DISC_INIT_EXTRA);

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

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [wallet]);
    console.log('ExtraAccountMetaList TX:', sig);
    console.log('Explorer:', explorerTx(sig));
  } else {
    console.log('ExtraAccountMetaList exists, skipping create');
  }

  console.log('\nDone! Testing SPL Execute simulation...');

  // Quick test: simulate a transfer
  const { createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await import('@solana/spl-token');

  const recipient = new PublicKey('2jcWr2gtGVePDPzJPQohibjsQbsfjdKuyHuGAnRyvSWu');
  const senderAta = getAssociatedTokenAddressSync(VUSDC, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const recipientAta = getAssociatedTokenAddressSync(VUSDC, recipient, false, TOKEN_2022_PROGRAM_ID);

  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    conn, senderAta, VUSDC, recipientAta, wallet.publicKey,
    BigInt(1_000_000), 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
  );

  console.log('Transfer instruction keys:', transferIx.keys.length);
  transferIx.keys.forEach((k, i) => console.log(`  ${i}: ${k.pubkey.toBase58().slice(0,16)}...`));

  const simTx = new Transaction().add(transferIx);
  simTx.feePayer = wallet.publicKey;
  const { blockhash } = await conn.getLatestBlockhash();
  simTx.recentBlockhash = blockhash;

  const sim = await conn.simulateTransaction(simTx, [wallet]);
  console.log('\nSimulation error:', JSON.stringify(sim.value.err));
  console.log('CU:', sim.value.unitsConsumed);
  sim.value.logs?.forEach(l => console.log('  ', l));
}

main().catch(console.error);
