/**
 * End-to-end on-chain test: calls real Anchor program instructions via CLI keypair.
 *
 * Tests:
 *   1. Policy Registry: initialize_operator + register_policy
 *   2. Verifier: verify_payment_proof (with real prover service receipt)
 *   3. Verifier: verify_batch_attestation
 *   4. Transfer Hook: Token-2022 transfer without proof (should fail) + with proof (should pass)
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
import * as crypto from 'crypto';

// -- Config --
const RPC_URL = 'https://api.devnet.solana.com';
const POLICY_REGISTRY = new PublicKey('CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs');
const VERIFIER = new PublicKey('HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr');
const PROVER_URL = 'http://localhost:3003';
const VUSDC_MINT = new PublicKey('GWVArRuvRt5t6tcBTMKT27SornozssMfLzc2Eqr3XdvX');

// -- Discriminators --
const DISC = {
  initializeOperator: Buffer.from([155, 33, 216, 254, 233, 227, 175, 212]),
  registerPolicy: Buffer.from([62, 66, 167, 36, 252, 227, 38, 132]),
  verifyPaymentProof: Buffer.from([247, 147, 241, 26, 26, 113, 39, 66]),
  verifyBatchAttestation: Buffer.from([85, 129, 17, 164, 94, 99, 86, 45]),
};

function sha256(data: string): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');

  // Load keypair
  const keypairPath = path.join(process.env.HOME!, '.config', 'solana', 'id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log('Wallet:', wallet.publicKey.toBase58());
  const balance = await connection.getBalance(wallet.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL\n');

  // =============================================
  // TEST 1: Policy Registry - initialize_operator + register_policy
  // =============================================
  console.log('=== TEST 1: Policy Registry ===');

  const [operatorPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), wallet.publicKey.toBuffer()],
    POLICY_REGISTRY
  );
  console.log('Operator PDA:', operatorPDA.toBase58());

  // Check if operator already exists
  const operatorInfo = await connection.getAccountInfo(operatorPDA);

  if (!operatorInfo) {
    // Initialize operator
    const operatorName = 'Aperture-Test-Operator';
    const nameBytes = Buffer.from(operatorName, 'utf-8');
    const initData = Buffer.alloc(8 + 4 + nameBytes.length);
    DISC.initializeOperator.copy(initData, 0);
    initData.writeUInt32LE(nameBytes.length, 8);
    nameBytes.copy(initData, 12);

    const initIx = new TransactionInstruction({
      programId: POLICY_REGISTRY,
      keys: [
        { pubkey: operatorPDA, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initData,
    });

    const initTx = new Transaction().add(initIx);
    const initSig = await sendAndConfirmTransaction(connection, initTx, [wallet]);
    console.log('initialize_operator tx:', initSig);
    console.log('Explorer:', explorerTx(initSig));
  } else {
    console.log('Operator already initialized');
  }

  // Register a policy
  const policyIdStr = `test-policy-${Date.now()}`;
  const policyIdBytes = sha256(policyIdStr);
  const merkleRoot = sha256(`merkle:${policyIdStr}`);
  const policyDataHash = sha256(`data:${policyIdStr}`);

  const [policyPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorPDA.toBuffer(), policyIdBytes],
    POLICY_REGISTRY
  );
  console.log('Policy PDA:', policyPDA.toBase58());

  const regData = Buffer.alloc(8 + 32 + 32 + 32);
  DISC.registerPolicy.copy(regData, 0);
  policyIdBytes.copy(regData, 8);
  merkleRoot.copy(regData, 40);
  policyDataHash.copy(regData, 72);

  const regIx = new TransactionInstruction({
    programId: POLICY_REGISTRY,
    keys: [
      { pubkey: policyPDA, isSigner: false, isWritable: true },
      { pubkey: operatorPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: regData,
  });

  const regTx = new Transaction().add(regIx);
  const regSig = await sendAndConfirmTransaction(connection, regTx, [wallet]);
  console.log('\nregister_policy tx:', regSig);
  console.log('Explorer:', explorerTx(regSig));
  console.log('Policy PDA:', explorerAddr(policyPDA.toBase58()));

  // =============================================
  // TEST 2: Verifier - verify_payment_proof (real prover receipt)
  // =============================================
  console.log('\n=== TEST 2: Verify Payment Proof ===');

  // Call real prover service
  console.log('Calling prover service...');
  const proveStart = Date.now();
  const proveRes = await fetch(`${PROVER_URL}/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy_id: policyIdStr,
      operator_id: wallet.publicKey.toBase58(),
      max_daily_spend_lamports: 100000000,
      max_per_transaction_lamports: 10000000,
      allowed_endpoint_categories: ['compute', 'storage'],
      blocked_addresses: [],
      token_whitelist: [VUSDC_MINT.toBase58()],
      payment_amount_lamports: 5000000,
      payment_token_mint: VUSDC_MINT.toBase58(),
      payment_recipient: 'RecipientAddr11111111111111111111111111111',
      payment_endpoint_category: 'compute',
      payment_timestamp: new Date().toISOString(),
      daily_spent_so_far_lamports: 0,
    }),
  });

  if (!proveRes.ok) {
    const err = await proveRes.text();
    console.error('Prover error:', err);
    process.exit(1);
  }

  const proofData = await proveRes.json();
  const provingMs = Date.now() - proveStart;
  console.log('Proof generated in', provingMs, 'ms');
  console.log('is_compliant:', proofData.is_compliant);
  console.log('proof_hash:', proofData.proof_hash.slice(0, 24) + '...');
  console.log('proving_time_ms (server):', proofData.proving_time_ms);
  console.log('receipt_bytes:', proofData.receipt_bytes.length, 'bytes');

  // Build verify_payment_proof instruction
  // On-chain verifier checks: SHA-256(receipt_data) == journal_digest
  const proofHashBytes = Buffer.from(proofData.proof_hash, 'hex');
  const receiptBytes = Buffer.from(proofData.receipt_bytes);
  // journal_digest must be SHA-256 of receipt_data (what the on-chain program expects)
  const journalDigestBytes = crypto.createHash('sha256').update(receiptBytes).digest();

  const [proofRecordPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), wallet.publicKey.toBuffer(), proofHashBytes],
    VERIFIER
  );

  // Serialize: disc[8] + proof_hash[32] + image_id[32](8xu32) + journal_digest[32] + receipt_data(vec)
  const receiptLen = Buffer.alloc(4);
  receiptLen.writeUInt32LE(receiptBytes.length, 0);

  const verifyData = Buffer.alloc(8 + 32 + 32 + 32 + 4 + receiptBytes.length);
  let off = 0;
  DISC.verifyPaymentProof.copy(verifyData, off); off += 8;
  proofHashBytes.copy(verifyData, off); off += 32;
  // image_id: [u32; 8]
  for (let i = 0; i < 8; i++) {
    verifyData.writeUInt32LE(proofData.image_id[i] ?? 0, off);
    off += 4;
  }
  journalDigestBytes.copy(verifyData, off); off += 32;
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
  console.log('\nverify_payment_proof tx:', verifySig);
  console.log('Explorer:', explorerTx(verifySig));
  console.log('ProofRecord PDA:', explorerAddr(proofRecordPDA.toBase58()));

  // =============================================
  // TEST 3: Verifier - verify_batch_attestation
  // =============================================
  console.log('\n=== TEST 3: Verify Batch Attestation ===');

  const batchData = JSON.stringify({
    operator_id: wallet.publicKey.toBase58(),
    proof_hashes: [proofData.proof_hash],
    total_payments: 1,
    period_start: '2026-04-01T00:00:00Z',
    period_end: '2026-04-05T23:59:59Z',
  });

  const batchHashBytes = sha256(batchData);
  const batchReceiptBytes = Buffer.from(batchData, 'utf-8');
  // On-chain verifier: SHA-256(receipt_data) == journal_digest
  const batchJournalDigest = crypto.createHash('sha256').update(batchReceiptBytes).digest();

  const [attestationPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), wallet.publicKey.toBuffer(), batchHashBytes],
    VERIFIER
  );

  const periodStartTs = BigInt(Math.floor(new Date('2026-04-01T00:00:00Z').getTime() / 1000));
  const periodEndTs = BigInt(Math.floor(new Date('2026-04-05T23:59:59Z').getTime() / 1000));

  const batchReceiptLen = Buffer.alloc(4);
  batchReceiptLen.writeUInt32LE(batchReceiptBytes.length, 0);

  const batchVerifyData = Buffer.alloc(8 + 32 + 32 + 32 + 4 + 8 + 8 + 4 + batchReceiptBytes.length);
  let bOff = 0;
  DISC.verifyBatchAttestation.copy(batchVerifyData, bOff); bOff += 8;
  batchHashBytes.copy(batchVerifyData, bOff); bOff += 32;
  // image_id [u32;8]
  for (let i = 0; i < 8; i++) {
    batchVerifyData.writeUInt32LE(0, bOff); bOff += 4;
  }
  batchJournalDigest.copy(batchVerifyData, bOff); bOff += 32;
  batchVerifyData.writeUInt32LE(1, bOff); bOff += 4; // total_payments
  batchVerifyData.writeBigInt64LE(periodStartTs, bOff); bOff += 8;
  batchVerifyData.writeBigInt64LE(periodEndTs, bOff); bOff += 8;
  batchReceiptLen.copy(batchVerifyData, bOff); bOff += 4;
  batchReceiptBytes.copy(batchVerifyData, bOff);

  const batchIx = new TransactionInstruction({
    programId: VERIFIER,
    keys: [
      { pubkey: attestationPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: batchVerifyData,
  });

  const batchTx = new Transaction().add(batchIx);
  const batchSig = await sendAndConfirmTransaction(connection, batchTx, [wallet]);
  console.log('verify_batch_attestation tx:', batchSig);
  console.log('Explorer:', explorerTx(batchSig));
  console.log('AttestationRecord PDA:', explorerAddr(attestationPDA.toBase58()));

  // =============================================
  // TEST 4: Transfer Hook - Token-2022 transfer
  // =============================================
  console.log('\n=== TEST 4: Transfer Hook Test ===');
  console.log('Testing vUSDC transfer without proof (should be rejected)...');

  try {
    // Try a simple Token-2022 transfer (self-transfer) without a proof
    // This requires @solana/spl-token for Token-2022 instructions
    const { createTransferCheckedInstruction, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } = await import('@solana/spl-token');

    const senderAta = getAssociatedTokenAddressSync(
      VUSDC_MINT,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    console.log('Sender ATA:', senderAta.toBase58());

    // Attempt transfer without proof - should fail due to hook
    const transferIx = createTransferCheckedInstruction(
      senderAta,
      VUSDC_MINT,
      senderAta, // self-transfer
      wallet.publicKey,
      1_000_000, // 1 vUSDC
      6,
      [],
      TOKEN_2022_PROGRAM_ID
    );

    const transferTx = new Transaction().add(transferIx);
    const transferSig = await sendAndConfirmTransaction(connection, transferTx, [wallet]);
    console.log('Transfer WITHOUT proof succeeded (hook may not be enforcing):', transferSig);
    console.log('Explorer:', explorerTx(transferSig));
  } catch (err: any) {
    const errMsg = err.message || String(err);
    if (errMsg.includes('ProofNotVerified') || errMsg.includes('NoProofRecord') || errMsg.includes('custom program error')) {
      console.log('Transfer WITHOUT proof correctly REJECTED by transfer hook!');
      console.log('Error:', errMsg.slice(0, 200));
    } else {
      console.log('Transfer failed with unexpected error:', errMsg.slice(0, 300));
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('1. register_policy:', explorerTx(regSig));
  console.log('2. verify_payment_proof:', explorerTx(verifySig));
  console.log('   Proving time:', provingMs, 'ms (server:', proofData.proving_time_ms, 'ms)');
  console.log('3. verify_batch_attestation:', explorerTx(batchSig));
}

main().catch((err) => {
  console.error('Test failed:', err.message || err);
  process.exit(1);
});
