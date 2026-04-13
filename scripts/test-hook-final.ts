/**
 * Final transfer hook test:
 * A) Transfer WITHOUT proof -> REJECTED by hook
 * B) Create proof on-chain, then transfer WITH proof -> PASSED
 */
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  SystemProgram, sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createTransferCheckedWithTransferHookInstruction,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const RPC = 'https://api.devnet.solana.com';
const VERIFIER = new PublicKey('AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU');
const VUSDC = new PublicKey('GWVArRuvRt5t6tcBTMKT27SornozssMfLzc2Eqr3XdvX');
const RECIPIENT = new PublicKey('2jcWr2gtGVePDPzJPQohibjsQbsfjdKuyHuGAnRyvSWu');
const PROVER = 'http://localhost:3003';
const POLICY_REG = new PublicKey('FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU');

function tx(sig: string) { return `https://explorer.solana.com/tx/${sig}?cluster=devnet`; }

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const wallet = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.config/solana/id.json'), 'utf-8'))
  ));
  const senderAta = getAssociatedTokenAddressSync(VUSDC, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const recipientAta = getAssociatedTokenAddressSync(VUSDC, RECIPIENT, false, TOKEN_2022_PROGRAM_ID);

  // =========================
  // TEST A: Transfer WITHOUT proof
  // =========================
  console.log('=== TEST A: Transfer WITHOUT Proof ===');
  try {
    const ix = await createTransferCheckedWithTransferHookInstruction(
      conn, senderAta, VUSDC, recipientAta, wallet.publicKey,
      BigInt(1_000_000), 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
    );
    const t = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, t, [wallet]);
    console.log('UNEXPECTED: Transfer succeeded:', sig);
    console.log('Explorer:', tx(sig));
  } catch (err: any) {
    const logs: string[] = err.transactionLogs || [];
    const rejected = logs.some(l => l.includes('REJECTED'));
    if (rejected) {
      console.log('CORRECT: Transfer REJECTED by transfer hook!');
      const rejectLog = logs.find(l => l.includes('REJECTED'));
      console.log('Hook log:', rejectLog);
      console.log('(No explorer link - transaction was rejected before landing on-chain)');
    } else {
      console.log('Failed:', err.message?.slice(0, 200));
      logs.slice(-3).forEach(l => console.log(' ', l));
    }
  }

  // =========================
  // TEST B: Create proof, then transfer
  // =========================
  console.log('\n=== TEST B: Create Proof + Transfer WITH Proof ===');

  // Step 1: Generate proof via prover
  console.log('Generating ZK proof...');
  const res = await fetch(`${PROVER}/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy_id: 'hook-final-test',
      operator_id: wallet.publicKey.toBase58(),
      max_daily_spend_lamports: 100000000,
      max_per_transaction_lamports: 10000000,
      allowed_endpoint_categories: ['compute'],
      blocked_addresses: [],
      token_whitelist: [VUSDC.toBase58()],
      payment_amount_lamports: 1000000,
      payment_token_mint: VUSDC.toBase58(),
      payment_recipient: RECIPIENT.toBase58(),
      payment_endpoint_category: 'compute',
      payment_timestamp: new Date().toISOString(),
      daily_spent_so_far_lamports: 0,
    }),
  });
  const proof = await res.json();
  console.log('is_compliant:', proof.is_compliant, '| proving_time:', proof.proving_time_ms, 'ms');

  // Step 2: Write ProofRecord on-chain
  const proofHash = Buffer.from(proof.proof_hash, 'hex');
  const receipt = Buffer.from(proof.receipt_bytes);
  const journalDigest = crypto.createHash('sha256').update(receipt).digest();

  const [proofPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), wallet.publicKey.toBuffer(), proofHash], VERIFIER
  );
  const [operatorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), wallet.publicKey.toBuffer()], POLICY_REG
  );
  // Use a known policy PDA (from earlier tests)
  const policyIdHash = crypto.createHash('sha256').update('hook-final-test').digest();
  const [policyPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorPDA.toBuffer(), policyIdHash], POLICY_REG
  );

  const DISC_VERIFY = Buffer.from([247, 147, 241, 26, 26, 113, 39, 66]);
  const receiptLen = Buffer.alloc(4);
  receiptLen.writeUInt32LE(receipt.length, 0);

  const verifyBuf = Buffer.alloc(8 + 32 + 32 + 32 + 4 + receipt.length);
  let o = 0;
  DISC_VERIFY.copy(verifyBuf, o); o += 8;
  proofHash.copy(verifyBuf, o); o += 32;
  for (let i = 0; i < 8; i++) { verifyBuf.writeUInt32LE(proof.image_id[i] ?? 0, o); o += 4; }
  journalDigest.copy(verifyBuf, o); o += 32;
  receiptLen.copy(verifyBuf, o); o += 4;
  receipt.copy(verifyBuf, o);

  const verifyIx = new TransactionInstruction({
    programId: VERIFIER,
    keys: [
      { pubkey: proofPDA, isSigner: false, isWritable: true },
      { pubkey: policyPDA, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: verifyBuf,
  });

  const verifyTx = new Transaction().add(verifyIx);
  const verifySig = await sendAndConfirmTransaction(conn, verifyTx, [wallet]);
  console.log('ProofRecord created on-chain!');
  console.log('verify_payment_proof TX:', verifySig);
  console.log('Explorer:', tx(verifySig));

  // Step 3: Transfer WITH proof -- add proofPDA as extra account
  console.log('\nAttempting transfer with proof on-chain...');
  const transferIx = await createTransferCheckedWithTransferHookInstruction(
    conn, senderAta, VUSDC, recipientAta, wallet.publicKey,
    BigInt(1_000_000), 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
  );
  // Add the ProofRecord PDA so the hook can find it
  transferIx.keys.push({
    pubkey: proofPDA, isSigner: false, isWritable: false,
  });

  try {
    const t = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(conn, t, [wallet]);
    console.log('Transfer WITH proof SUCCEEDED!');
    console.log('TX:', sig);
    console.log('Explorer:', tx(sig));
  } catch (err: any) {
    console.log('Transfer with proof failed:', err.message?.slice(0, 300));
    const logs: string[] = err.transactionLogs || [];
    logs.slice(-5).forEach(l => console.log(' ', l));
  }

  console.log('\n=== SUMMARY ===');
}

main().catch(console.error);
