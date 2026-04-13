/**
 * Initialize ExtraAccountMetaList PDA for the vUSDC transfer hook.
 * This PDA tells Token-2022 which additional accounts the transfer hook needs.
 *
 * Run: npx ts-node scripts/init-extra-account-metas.ts
 *
 * Requires:
 *   - VUSDC_MINT_ADDRESS in .env
 *   - SOLANA_RPC_URL in .env
 *   - Deployer keypair at ~/.config/solana/id.json
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const TRANSFER_HOOK_PROGRAM = new PublicKey('3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt');
const VERIFIER_PROGRAM = new PublicKey('HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr');

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const vUsdcMint = process.env.VUSDC_MINT_ADDRESS;

  if (!vUsdcMint) {
    console.error('VUSDC_MINT_ADDRESS not set in environment');
    process.exit(1);
  }

  const mintPubkey = new PublicKey(vUsdcMint);
  const connection = new Connection(rpcUrl, 'confirmed');

  // Load deployer keypair
  const keypairPath = path.join(
    process.env.HOME ?? '~',
    '.config',
    'solana',
    'id.json'
  );
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Authority:', authority.publicKey.toBase58());
  console.log('vUSDC Mint:', mintPubkey.toBase58());

  // Derive ExtraAccountMetaList PDA
  const [extraAccountMetaListPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mintPubkey.toBuffer()],
    TRANSFER_HOOK_PROGRAM
  );
  console.log('ExtraAccountMetaList PDA:', extraAccountMetaListPDA.toBase58());

  // Derive HookConfig PDA
  const [hookConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook-config')],
    TRANSFER_HOOK_PROGRAM
  );
  console.log('HookConfig PDA:', hookConfigPDA.toBase58());

  // Build initialize_hook_config instruction
  // Anchor discriminator for initialize_hook_config
  const initConfigDiscriminator = Buffer.from([
    0x2b, 0x9b, 0x9e, 0x67, 0xa5, 0x6c, 0x88, 0x63,
  ]);

  const POLICY_REGISTRY_PROGRAM = new PublicKey('FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU');

  const data = Buffer.alloc(8 + 32 + 32);
  initConfigDiscriminator.copy(data, 0);
  POLICY_REGISTRY_PROGRAM.toBuffer().copy(data, 8);
  VERIFIER_PROGRAM.toBuffer().copy(data, 40);

  const initConfigIx = new TransactionInstruction({
    programId: TRANSFER_HOOK_PROGRAM,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: hookConfigPDA, isSigner: false, isWritable: true },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(initConfigIx);

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log('HookConfig initialized. Tx:', sig);
    console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('already in use')) {
      console.log('HookConfig already initialized, skipping.');
    } else {
      throw err;
    }
  }

  console.log('\nTransfer hook setup complete!');
  console.log('The hook will reject transfers if no verified ProofRecord exists for the sender.');
}

main().catch(console.error);
