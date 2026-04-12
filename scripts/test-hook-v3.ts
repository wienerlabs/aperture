import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { createTransferCheckedWithTransferHookInstruction, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const RPC = 'https://api.devnet.solana.com';
const VERIFIER = new PublicKey('HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr');
const POLICY_REG = new PublicKey('CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs');
const VUSDC = new PublicKey('E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar');
const RECIPIENT = new PublicKey('2jcWr2gtGVePDPzJPQohibjsQbsfjdKuyHuGAnRyvSWu');
const PROVER = 'http://localhost:3003';

function tx(sig: string) { return `https://explorer.solana.com/tx/${sig}?cluster=devnet`; }

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const wallet = Keypair.fromSecretKey(Uint8Array.from(
    JSON.parse(fs.readFileSync(path.join(process.env.HOME!, '.config/solana/id.json'), 'utf-8'))
  ));
  const senderAta = getAssociatedTokenAddressSync(VUSDC, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const recipientAta = getAssociatedTokenAddressSync(VUSDC, RECIPIENT, false, TOKEN_2022_PROGRAM_ID);

  // =========================
  // TEST A: Transfer WITHOUT proof (ComplianceStatus doesn't exist)
  // =========================
  console.log('=== TEST A: Transfer WITHOUT Proof ===');
  try {
    const ix = await createTransferCheckedWithTransferHookInstruction(
      conn, senderAta, VUSDC, recipientAta, wallet.publicKey,
      BigInt(1_000_000), 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
    );
    const t = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, t, [wallet]);
    console.log('UNEXPECTED SUCCESS:', sig);
  } catch (err: any) {
    const msg = err.message || String(err);
    if (msg.includes('TokenTransferHookAccountNotFound') || msg.includes('REJECTED') || msg.includes('custom program error')) {
      console.log('CORRECT: Transfer REJECTED!');
      console.log('Reason: ComplianceStatus PDA does not exist (no proof on-chain)');
    } else {
      console.log('Error:', msg.slice(0, 200));
    }
  }

  // =========================
  // TEST B: Create proof (creates ComplianceStatus), then transfer
  // =========================
  console.log('\n=== TEST B: Create Proof + Transfer ===');

  // Step 1: Generate proof
  console.log('Generating ZK proof...');
  const res = await fetch(`${PROVER}/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy_id: 'hook-v3-test',
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
  console.log('is_compliant:', proof.is_compliant, '| time:', proof.proving_time_ms, 'ms');

  // Step 2: Write proof + ComplianceStatus on-chain
  const proofHash = Buffer.from(proof.proof_hash, 'hex');
  const receipt = Buffer.from(proof.receipt_bytes);
  const journalDigest = crypto.createHash('sha256').update(receipt).digest();

  const [proofPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), wallet.publicKey.toBuffer(), proofHash], VERIFIER
  );
  const [compliancePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('compliance'), wallet.publicKey.toBuffer()], VERIFIER
  );
  const [operatorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), wallet.publicKey.toBuffer()], POLICY_REG
  );
  const policyIdHash = crypto.createHash('sha256').update('hook-v3-test').digest();
  const [policyPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorPDA.toBuffer(), policyIdHash], POLICY_REG
  );

  // Build verify_payment_proof (now includes ComplianceStatus)
  const DISC = Buffer.from([247, 147, 241, 26, 26, 113, 39, 66]);
  const receiptLen = Buffer.alloc(4);
  receiptLen.writeUInt32LE(receipt.length, 0);
  const buf = Buffer.alloc(8 + 32 + 32 + 32 + 4 + receipt.length);
  let o = 0;
  DISC.copy(buf, o); o += 8;
  proofHash.copy(buf, o); o += 32;
  for (let i = 0; i < 8; i++) { buf.writeUInt32LE(proof.image_id[i] ?? 0, o); o += 4; }
  journalDigest.copy(buf, o); o += 32;
  receiptLen.copy(buf, o); o += 4;
  receipt.copy(buf, o);

  const verifyIx = new TransactionInstruction({
    programId: VERIFIER,
    keys: [
      { pubkey: proofPDA, isSigner: false, isWritable: true },
      { pubkey: compliancePDA, isSigner: false, isWritable: true }, // NEW: ComplianceStatus
      { pubkey: policyPDA, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: buf,
  });

  const verifyTx = new Transaction().add(verifyIx);
  const verifySig = await sendAndConfirmTransaction(conn, verifyTx, [wallet]);
  console.log('ProofRecord + ComplianceStatus created!');
  console.log('verify_payment_proof TX:', verifySig);
  console.log('Explorer:', tx(verifySig));

  // Step 3: Transfer WITH proof
  console.log('\nAttempting transfer with ComplianceStatus on-chain...');
  try {
    const transferIx = await createTransferCheckedWithTransferHookInstruction(
      conn, senderAta, VUSDC, recipientAta, wallet.publicKey,
      BigInt(1_000_000), 6, undefined, undefined, TOKEN_2022_PROGRAM_ID
    );

    console.log('Transfer instruction accounts:', transferIx.keys.length);

    const t = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(conn, t, [wallet]);
    console.log('Transfer WITH proof SUCCEEDED!');
    console.log('TX:', sig);
    console.log('Explorer:', tx(sig));
  } catch (err: any) {
    console.log('Transfer failed:', err.message?.slice(0, 500));
    const logs: string[] = err.transactionLogs || err.logs || [];
    logs.forEach((l: string) => console.log(' ', l));
    if (logs.length === 0) console.log('Raw error:', JSON.stringify(err).slice(0, 500));
  }
}

main().catch(console.error);
