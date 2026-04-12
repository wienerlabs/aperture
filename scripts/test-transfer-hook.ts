/**
 * Test transfer hook: vUSDC transfer without proof (should be rejected)
 * and with proof (should pass).
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
import {
  createTransferCheckedWithTransferHookInstruction,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const RPC_URL = 'https://api.devnet.solana.com';
const TRANSFER_HOOK_PROGRAM = new PublicKey('3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt');
const VERIFIER = new PublicKey('HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr');
const VUSDC_MINT = new PublicKey('GWVArRuvRt5t6tcBTMKT27SornozssMfLzc2Eqr3XdvX');
const PROVER_URL = 'http://localhost:3003';

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

  const senderAta = getAssociatedTokenAddressSync(
    VUSDC_MINT,
    wallet.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  console.log('Sender ATA:', senderAta.toBase58());

  // Derive hook PDAs
  const [hookConfigPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('hook-config')],
    TRANSFER_HOOK_PROGRAM
  );
  const [extraMetasPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('extra-account-metas'), VUSDC_MINT.toBuffer()],
    TRANSFER_HOOK_PROGRAM
  );

  // ==============================
  // TEST A: Transfer WITHOUT proof (should fail)
  // ==============================
  console.log('\n=== TEST A: Transfer WITHOUT Proof ===');
  try {
    // Use createTransferCheckedWithTransferHookInstruction which properly
    // resolves ExtraAccountMeta PDAs and triggers the hook via Token-2022 CPI
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      connection,
      senderAta,            // source
      VUSDC_MINT,           // mint
      senderAta,            // destination (self-transfer)
      wallet.publicKey,     // authority
      BigInt(1_000_000),    // amount (1 vUSDC)
      6,                    // decimals
      undefined,            // multiSigners
      undefined,            // confirmOptions
      TOKEN_2022_PROGRAM_ID // programId
    );

    const tx = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('UNEXPECTED: Transfer succeeded without proof');
    console.log('TX:', sig);
    console.log('Explorer:', explorerTx(sig));
  } catch (err: any) {
    const msg = err.message || String(err);
    const logs = err.transactionLogs || [];

    if (msg.includes('NoProofRecord') || msg.includes('ProofNotVerified') ||
        msg.includes('custom program error') || logs.some((l: string) => l.includes('NoProofRecord'))) {
      console.log('CORRECT: Transfer REJECTED by transfer hook!');
      console.log('Reason:', logs.find((l: string) => l.includes('Error')) || msg.slice(0, 200));
    } else {
      console.log('Transfer failed (different reason):', msg.slice(0, 300));
      if (logs.length > 0) {
        console.log('Logs:', logs.slice(-5).join('\n'));
      }
    }
  }

  // ==============================
  // TEST B: Create proof first, then transfer WITH proof
  // ==============================
  console.log('\n=== TEST B: Create Proof + Transfer WITH Proof ===');

  // Step 1: Generate proof via prover service
  console.log('Generating ZK proof...');
  const proveRes = await fetch(`${PROVER_URL}/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy_id: 'hook-test-policy',
      operator_id: wallet.publicKey.toBase58(),
      max_daily_spend_lamports: 100000000,
      max_per_transaction_lamports: 10000000,
      allowed_endpoint_categories: ['compute'],
      blocked_addresses: [],
      token_whitelist: [VUSDC_MINT.toBase58()],
      payment_amount_lamports: 1000000,
      payment_token_mint: VUSDC_MINT.toBase58(),
      payment_recipient: wallet.publicKey.toBase58(),
      payment_endpoint_category: 'compute',
      payment_timestamp: new Date().toISOString(),
      daily_spent_so_far_lamports: 0,
    }),
  });

  if (!proveRes.ok) {
    console.error('Prover error:', await proveRes.text());
    return;
  }

  const proofData = await proveRes.json();
  console.log('Proof generated! is_compliant:', proofData.is_compliant);

  // Step 2: Write ProofRecord on-chain via verifier program
  const proofHashBytes = Buffer.from(proofData.proof_hash, 'hex');
  const receiptBytes = Buffer.from(proofData.receipt_bytes);
  const journalDigest = crypto.createHash('sha256').update(receiptBytes).digest();

  const [proofRecordPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), wallet.publicKey.toBuffer(), proofHashBytes],
    VERIFIER
  );

  // Read policy PDA from earlier test
  const policyIdBytes = crypto.createHash('sha256').update('hook-test-policy').digest();
  const [operatorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), wallet.publicKey.toBuffer()],
    new PublicKey('CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs')
  );
  const [policyPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorPDA.toBuffer(), policyIdBytes],
    new PublicKey('CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs')
  );

  // Build verify_payment_proof instruction
  const DISC_VERIFY = Buffer.from([247, 147, 241, 26, 26, 113, 39, 66]);
  const receiptLen = Buffer.alloc(4);
  receiptLen.writeUInt32LE(receiptBytes.length, 0);

  const verifyData = Buffer.alloc(8 + 32 + 32 + 32 + 4 + receiptBytes.length);
  let off = 0;
  DISC_VERIFY.copy(verifyData, off); off += 8;
  proofHashBytes.copy(verifyData, off); off += 32;
  for (let i = 0; i < 8; i++) {
    verifyData.writeUInt32LE(proofData.image_id[i] ?? 0, off); off += 4;
  }
  journalDigest.copy(verifyData, off); off += 32;
  receiptLen.copy(verifyData, off); off += 4;
  receiptBytes.copy(verifyData, off);

  const verifyIx = new TransactionInstruction({
    programId: VERIFIER,
    keys: [
      { pubkey: proofRecordPDA, isSigner: false, isWritable: true },
      { pubkey: policyPDA, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: verifyData,
  });

  const verifyTx = new Transaction().add(verifyIx);
  const verifySig = await sendAndConfirmTransaction(connection, verifyTx, [wallet]);
  console.log('ProofRecord written on-chain!');
  console.log('verify_payment_proof TX:', verifySig);
  console.log('Explorer:', explorerTx(verifySig));

  // Step 3: Now try the transfer (with proof on-chain)
  console.log('\nAttempting transfer with proof on-chain...');
  try {
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
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

    const tx = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log('Transfer WITH proof SUCCEEDED!');
    console.log('TX:', sig);
    console.log('Explorer:', explorerTx(sig));
  } catch (err: any) {
    console.log('Transfer with proof failed:', err.message?.slice(0, 300));
    const logs = err.transactionLogs || [];
    if (logs.length > 0) {
      console.log('Logs:', logs.slice(-5).join('\n'));
    }
  }
}

main().catch(console.error);
