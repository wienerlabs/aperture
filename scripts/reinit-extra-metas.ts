/**
 * Closes the existing ExtraAccountMetaList PDA for the aUSDC mint and
 * re-initializes it with the 5-extra-account layout shipped in Adim 6
 * (verifier program + HookConfig + ComplianceStatus + OperatorState
 * + ProofRecord). One-shot migration script; safe to re-run because the
 * close path is idempotent (no PDA means nothing to close).
 *
 * Usage:
 *   npx tsx scripts/reinit-extra-metas.ts
 *
 * Reads AUSDC_MINT_ADDRESS (preferred), falling back to the legacy
 * VUSDC_MINT_ADDRESS env so already-rolled-out .env files keep working.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const TRANSFER_HOOK_PROGRAM = new PublicKey(
  '3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt',
);
const VERIFIER_PROGRAM = new PublicKey(
  'AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU',
);

const DISC_INIT_EXTRA_METAS = Buffer.from([
  0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const DISC_CLOSE_EXTRA_METAS = Buffer.from([
  0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

async function main(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const mintStr =
    process.env.AUSDC_MINT_ADDRESS ??
    process.env.VUSDC_MINT_ADDRESS ??
    process.env.NEXT_PUBLIC_VUSDC_MINT;
  if (!mintStr) {
    throw new Error('AUSDC_MINT_ADDRESS or VUSDC_MINT_ADDRESS must be set');
  }
  const mint = new PublicKey(mintStr);
  const connection = new Connection(rpcUrl, 'confirmed');

  const keypairPath = path.join(
    process.env.HOME ?? '~',
    '.config',
    'solana',
    'id.json',
  );
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Authority           :', authority.publicKey.toBase58());
  console.log('aUSDC Mint          :', mint.toBase58());

  const [extraMetasPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), mint.toBuffer()],
    TRANSFER_HOOK_PROGRAM,
  );
  const [hookConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook-config')],
    TRANSFER_HOOK_PROGRAM,
  );
  console.log('ExtraAccountMetaList:', extraMetasPda.toBase58());
  console.log('HookConfig          :', hookConfigPda.toBase58());

  // ---- 1. close ---------------------------------------------------------
  const existing = await connection.getAccountInfo(extraMetasPda);
  if (existing) {
    console.log(
      `\nClosing existing PDA (${existing.data.length} bytes, owner=${existing.owner.toBase58()})...`,
    );
    const closeIx = new TransactionInstruction({
      programId: TRANSFER_HOOK_PROGRAM,
      keys: [
        { pubkey: extraMetasPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: hookConfigPda, isSigner: false, isWritable: false },
      ],
      data: DISC_CLOSE_EXTRA_METAS,
    });
    const tx = new Transaction().add(closeIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log('Close tx            :', sig);
  } else {
    console.log('\nNo existing PDA to close, proceeding to init.');
  }

  // ---- 2. init with new 5-account layout --------------------------------
  console.log('\nInitializing new ExtraAccountMetaList...');
  const initIx = new TransactionInstruction({
    programId: TRANSFER_HOOK_PROGRAM,
    keys: [
      { pubkey: extraMetasPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: DISC_INIT_EXTRA_METAS,
  });
  const tx = new Transaction().add(initIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log('Init tx             :', sig);

  // ---- 3. verify --------------------------------------------------------
  const after = await connection.getAccountInfo(extraMetasPda);
  if (!after) {
    throw new Error('Init succeeded but PDA still not present?');
  }
  console.log('\nNew PDA size        :', after.data.length, 'bytes');
  console.log('Owner               :', after.owner.toBase58());
  console.log('\nDone. Transfer-hook now resolves 5 extra accounts on every transfer.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
