/**
 * Initialize HookConfig and ExtraAccountMetaList for the vUSDC transfer hook.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = 'https://api.devnet.solana.com';
const TRANSFER_HOOK_PROGRAM = new PublicKey('3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt');
const POLICY_REGISTRY = new PublicKey('CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs');
const VERIFIER = new PublicKey('HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr');
const VUSDC_MINT = new PublicKey('GWVArRuvRt5t6tcBTMKT27SornozssMfLzc2Eqr3XdvX');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

// Anchor discriminators
const DISC_INIT_CONFIG = Buffer.from([0x2b, 0x9b, 0x9e, 0x67, 0xa5, 0x6c, 0x88, 0x63]);
const DISC_INIT_EXTRA_METAS = Buffer.from([43, 34, 13, 49, 167, 88, 235, 235]); // will compute

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  const keypairPath = path.join(process.env.HOME!, '.config', 'solana', 'id.json');
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')))
  );
  console.log('Wallet:', wallet.publicKey.toBase58());

  // Derive PDAs
  const [hookConfigPDA, hookConfigBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook-config')],
    TRANSFER_HOOK_PROGRAM
  );
  console.log('HookConfig PDA:', hookConfigPDA.toBase58());

  const [extraMetasPDA, extraMetasBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), VUSDC_MINT.toBuffer()],
    TRANSFER_HOOK_PROGRAM
  );
  console.log('ExtraAccountMetaList PDA:', extraMetasPDA.toBase58());

  // Step 1: Initialize HookConfig (if not already)
  const hookConfigInfo = await connection.getAccountInfo(hookConfigPDA);
  if (!hookConfigInfo) {
    console.log('\n--- Initializing HookConfig ---');

    // Read the IDL to get correct discriminator
    const idlPath = path.join(process.cwd(), 'target', 'idl', 'transfer_hook.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const initConfigIx = idl.instructions.find((i: any) => i.name === 'initialize_hook_config');
    const disc = Buffer.from(initConfigIx.discriminator);

    // Borsh: disc[8] + policy_registry_program[32] + verifier_program[32]
    const data = Buffer.alloc(8 + 32 + 32);
    disc.copy(data, 0);
    POLICY_REGISTRY.toBuffer().copy(data, 8);
    VERIFIER.toBuffer().copy(data, 40);

    const ix = new TransactionInstruction({
      programId: TRANSFER_HOOK_PROGRAM,
      keys: [
        { pubkey: hookConfigPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('HookConfig initialized!');
    console.log('TX:', sig);
    console.log('Explorer:', explorerTx(sig));
  } else {
    console.log('HookConfig already exists');
  }

  // Step 2: Initialize ExtraAccountMetaList (if not already)
  const extraMetasInfo = await connection.getAccountInfo(extraMetasPDA);
  if (!extraMetasInfo) {
    console.log('\n--- Initializing ExtraAccountMetaList ---');

    const idlPath = path.join(process.cwd(), 'target', 'idl', 'transfer_hook.json');
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const initExtraIx = idl.instructions.find((i: any) => i.name === 'initialize_extra_account_meta_list');
    const disc = Buffer.from(initExtraIx.discriminator);

    // No args, just discriminator
    const data = Buffer.from(disc);

    const ix = new TransactionInstruction({
      programId: TRANSFER_HOOK_PROGRAM,
      keys: [
        { pubkey: extraMetasPDA, isSigner: false, isWritable: true },
        { pubkey: VUSDC_MINT, isSigner: false, isWritable: false },
        { pubkey: hookConfigPDA, isSigner: false, isWritable: false },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('ExtraAccountMetaList initialized!');
    console.log('TX:', sig);
    console.log('Explorer:', explorerTx(sig));
  } else {
    console.log('ExtraAccountMetaList already exists');
  }

  console.log('\nTransfer hook setup complete!');
  console.log('HookConfig:', hookConfigPDA.toBase58());
  console.log('ExtraAccountMetaList:', extraMetasPDA.toBase58());
}

main().catch(console.error);
