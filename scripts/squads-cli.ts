/**
 * scripts/squads-cli.ts
 *
 * UI-free Squads V4 control plane for Aperture. Subcommand-driven; every
 * action goes through @sqds/multisig and mirrors state to policy-service
 * so the dashboard stays in sync without anyone touching app.squads.so or
 * devnet.squads.so.
 *
 * Subcommands:
 *
 *   lookup           Read multisig metadata (members, threshold, txIndex,
 *                    vault PDA, vault SOL balance).
 *
 *   propose-policy   vaultTransactionCreate + proposalCreate for the policy
 *                    registry's register_policy_multisig or
 *                    update_policy_multisig instruction. Returns
 *                    transactionIndex / transactionPda / proposalPda /
 *                    policyPda and (optionally) writes a row in
 *                    multisig_proposals via POST /api/v1/squads/proposal.
 *
 *   approve          proposalApprove. For 1-of-N multisigs the same key
 *                    that proposed can also approve. Optionally PATCHes
 *                    the policy-service mirror with the new approval count.
 *
 *   execute          vaultTransactionExecute. CPIs into policy-registry,
 *                    so register_policy / update_policy lands on chain.
 *                    Optionally PATCHes the mirror to status=executed
 *                    with the executed_tx signature.
 *
 *   auto-policy      Convenience for 1-of-1 multisigs: propose + approve +
 *                    execute in one shot. Mirrors every step to
 *                    policy-service.
 *
 * Examples (from repo root):
 *
 *   tsx scripts/squads-cli.ts lookup \
 *     --multisig qbpkipnWm8d4TkEX9fiZgvqEeFvzvZ9ReP8bLbs3H1e
 *
 *   tsx scripts/squads-cli.ts auto-policy \
 *     --multisig qbpkipnWm8d4TkEX9fiZgvqEeFvzvZ9ReP8bLbs3H1e \
 *     --action register \
 *     --policy-id <32-byte-hex> \
 *     --merkle-root <32-byte-hex> \
 *     --policy-hash <32-byte-hex>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

// =====================================================================
// argv parsing
// =====================================================================

type Flags = Record<string, string | true>;

function parseFlags(argv: readonly string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]!;
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function flagStr(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function flagBool(flags: Flags, key: string): boolean {
  return flags[key] === true || flags[key] === 'true';
}

function flagInt(flags: Flags, key: string, fallback?: number): number | undefined {
  const v = flagStr(flags, key);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number, got "${v}"`);
  return n;
}

interface CommonArgs {
  readonly rpcUrl: string;
  readonly policyServiceUrl: string;
  readonly policyRegistryProgramId: string;
  readonly keypair: string;
  readonly skipCache: boolean;
}

function commonArgs(flags: Flags): CommonArgs {
  return {
    rpcUrl:
      flagStr(flags, 'rpc-url') ??
      process.env.SOLANA_RPC_URL ??
      'https://api.devnet.solana.com',
    policyServiceUrl:
      flagStr(flags, 'policy-service-url') ??
      process.env.POLICY_SERVICE_URL ??
      'http://localhost:3001',
    policyRegistryProgramId:
      flagStr(flags, 'policy-registry-program') ??
      process.env.POLICY_REGISTRY_PROGRAM ??
      'FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU',
    keypair: flagStr(flags, 'keypair') ?? './.aperture-operator.json',
    skipCache: flagBool(flags, 'skip-cache'),
  };
}

// =====================================================================
// keypair + hex helpers
// =====================================================================

function loadKeypair(filePath: string): Keypair {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Keypair not found at ${resolved}. Run scripts/squads-devnet-bind.ts first or pass --keypair.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  if (!Array.isArray(raw)) throw new Error(`${resolved}: expected JSON array of bytes`);
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function hex32(value: string, label: string): Buffer {
  const stripped = value.startsWith('0x') ? value.slice(2) : value;
  if (stripped.length !== 64) {
    throw new Error(`--${label} must be 32-byte hex (64 hex chars), got ${stripped.length}`);
  }
  if (!/^[0-9a-fA-F]+$/.test(stripped)) {
    throw new Error(`--${label} contains non-hex characters`);
  }
  return Buffer.from(stripped, 'hex');
}

function randomHex32(): string {
  return crypto.randomBytes(32).toString('hex');
}

// =====================================================================
// Aperture policy-registry IX builders (mirror of dashboard/src/lib/anchor-instructions.ts)
// =====================================================================

const REGISTER_POLICY_MULTISIG_DISC = Buffer.from([
  167, 107, 137, 228, 227, 133, 173, 190,
]);
const UPDATE_POLICY_MULTISIG_DISC = Buffer.from([
  88, 233, 184, 252, 171, 126, 180, 83,
]);
const SQUADS_PROGRAM_ID = new PublicKey(
  'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf',
);

function deriveOperatorPda(authority: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    programId,
  )[0];
}

function derivePolicyPda(
  operatorPda: PublicKey,
  policyIdBytes: Buffer,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('policy'), operatorPda.toBuffer(), policyIdBytes],
    programId,
  )[0];
}

interface RegisterIxArgs {
  readonly authority: PublicKey;
  readonly multisigPda: PublicKey;
  readonly vaultPda: PublicKey;
  readonly vaultIndex: number;
  readonly policyIdBytes: Buffer;
  readonly merkleRoot: Buffer;
  readonly policyDataHash: Buffer;
  readonly programId: PublicKey;
}

function buildRegisterPolicyMultisigIx(
  args: RegisterIxArgs,
): { instruction: TransactionInstruction; policyPda: PublicKey } {
  const operatorPda = deriveOperatorPda(args.authority, args.programId);
  const policyPda = derivePolicyPda(operatorPda, args.policyIdBytes, args.programId);

  const data = Buffer.alloc(8 + 32 + 32 + 32 + 1);
  REGISTER_POLICY_MULTISIG_DISC.copy(data, 0);
  args.policyIdBytes.copy(data, 8);
  args.merkleRoot.copy(data, 40);
  args.policyDataHash.copy(data, 72);
  data.writeUInt8(args.vaultIndex, 104);

  const instruction = new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: operatorPda, isSigner: false, isWritable: true },
      { pubkey: args.multisigPda, isSigner: false, isWritable: false },
      { pubkey: args.vaultPda, isSigner: true, isWritable: false },
      { pubkey: args.vaultPda, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  return { instruction, policyPda };
}

interface UpdateIxArgs {
  readonly authority: PublicKey;
  readonly multisigPda: PublicKey;
  readonly vaultPda: PublicKey;
  readonly vaultIndex: number;
  readonly policyPda: PublicKey;
  readonly merkleRoot: Buffer;
  readonly policyDataHash: Buffer;
  readonly programId: PublicKey;
}

function buildUpdatePolicyMultisigIx(args: UpdateIxArgs): TransactionInstruction {
  const operatorPda = deriveOperatorPda(args.authority, args.programId);

  const data = Buffer.alloc(8 + 32 + 32 + 1);
  UPDATE_POLICY_MULTISIG_DISC.copy(data, 0);
  args.merkleRoot.copy(data, 8);
  args.policyDataHash.copy(data, 40);
  data.writeUInt8(args.vaultIndex, 72);

  return new TransactionInstruction({
    programId: args.programId,
    keys: [
      { pubkey: args.policyPda, isSigner: false, isWritable: true },
      { pubkey: operatorPda, isSigner: false, isWritable: false },
      { pubkey: args.multisigPda, isSigner: false, isWritable: false },
      { pubkey: args.vaultPda, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// =====================================================================
// policy-service HTTP mirror
// =====================================================================

interface RecordProposalBody {
  readonly operator_id: string;
  readonly multisig_address: string;
  readonly transaction_index: number;
  readonly transaction_pda: string;
  readonly proposal_pda?: string;
  readonly action: 'register_policy' | 'update_policy' | 'deactivate_policy' | 'rotate_multisig' | 'custom';
  readonly policy_id?: string;
  readonly target_merkle_root?: string;
  readonly target_policy_hash?: string;
  readonly created_by: string;
}

interface RecordedProposal {
  readonly id: string;
  readonly transactionIndex: number;
}

async function postProposal(
  policyServiceUrl: string,
  body: RecordProposalBody,
): Promise<RecordedProposal | null> {
  const url = `${policyServiceUrl.replace(/\/$/, '')}/api/v1/squads/proposal`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { success?: boolean; data?: RecordedProposal; error?: string };
    if (!res.ok || !json.success || !json.data) {
      console.warn(`  cache mirror failed (${res.status}): ${json.error ?? 'unknown'}`);
      return null;
    }
    return json.data;
  } catch (err) {
    console.warn(
      `  policy-service unreachable: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

interface PatchStatusBody {
  readonly status: 'pending' | 'approved' | 'executed' | 'rejected' | 'cancelled' | 'expired';
  readonly approval_count?: number;
  readonly rejection_count?: number;
  readonly executed_tx?: string;
}

async function patchProposalStatus(
  policyServiceUrl: string,
  proposalId: string,
  body: PatchStatusBody,
): Promise<boolean> {
  const url = `${policyServiceUrl.replace(/\/$/, '')}/api/v1/squads/proposal/${proposalId}/status`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      console.warn(`  cache patch failed (${res.status}): ${txt}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `  policy-service unreachable: ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}

// =====================================================================
// shared on-chain helpers
// =====================================================================

interface MultisigSnapshot {
  readonly account: Awaited<ReturnType<typeof multisig.accounts.Multisig.fromAccountAddress>>;
  readonly currentTransactionIndex: bigint;
  readonly nextTransactionIndex: bigint;
  readonly threshold: number;
  readonly memberCount: number;
}

async function readMultisig(
  conn: Connection,
  multisigPda: PublicKey,
): Promise<MultisigSnapshot> {
  const account = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda);
  const currentTransactionIndex = BigInt(account.transactionIndex.toString());
  return {
    account,
    currentTransactionIndex,
    nextTransactionIndex: currentTransactionIndex + 1n,
    threshold: account.threshold,
    memberCount: account.members.length,
  };
}

async function sendLegacyTx(
  conn: Connection,
  signer: Keypair,
  instructions: readonly TransactionInstruction[],
): Promise<string> {
  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash });
  instructions.forEach((ix) => tx.add(ix));
  tx.sign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

async function sendV0Tx(
  conn: Connection,
  signer: Keypair,
  instructions: readonly TransactionInstruction[],
  lookupTables: readonly AddressLookupTableAccount[],
): Promise<string> {
  const { blockhash } = await conn.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: signer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...instructions],
  }).compileToV0Message([...lookupTables]);
  const tx = new VersionedTransaction(message);
  tx.sign([signer]);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, 'confirmed');
  return sig;
}

// =====================================================================
// subcommand: lookup
// =====================================================================

async function cmdLookup(flags: Flags): Promise<void> {
  const common = commonArgs(flags);
  const multisigAddress = flagStr(flags, 'multisig');
  if (!multisigAddress) throw new Error('--multisig required');
  const vaultIndex = flagInt(flags, 'vault-index', 0)!;

  const conn = new Connection(common.rpcUrl, 'confirmed');
  const multisigPda = new PublicKey(multisigAddress);
  const snap = await readMultisig(conn, multisigPda);

  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: vaultIndex });
  const vaultBalance = await conn.getBalance(vaultPda);

  console.log('Aperture · Squads multisig lookup');
  console.log('─────────────────────────────────');
  console.log(`Multisig PDA          : ${multisigAddress}`);
  console.log(`Threshold             : ${snap.threshold} of ${snap.memberCount}`);
  console.log(`Current tx index      : ${snap.currentTransactionIndex.toString()}`);
  console.log(`Stale tx index        : ${snap.account.staleTransactionIndex.toString()}`);
  console.log(`Members (${snap.memberCount}):`);
  snap.account.members.forEach((m, i) => {
    console.log(
      `  [${i}] ${m.key.toBase58()}   permissions=0b${m.permissions.mask.toString(2).padStart(3, '0')}`,
    );
  });
  console.log(`Vault[${vaultIndex}] PDA          : ${vaultPda.toBase58()}`);
  console.log(`Vault[${vaultIndex}] balance      : ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
}

// =====================================================================
// subcommand: propose-policy
// =====================================================================

interface ProposeResult {
  readonly transactionIndex: bigint;
  readonly transactionPda: PublicKey;
  readonly proposalPda: PublicKey;
  readonly policyPda: PublicKey;
  readonly signature: string;
  readonly proposalRecordId: string | null;
}

async function proposePolicyCore(
  conn: Connection,
  signer: Keypair,
  flags: Flags,
  common: CommonArgs,
): Promise<ProposeResult> {
  const multisigAddress = flagStr(flags, 'multisig');
  if (!multisigAddress) throw new Error('--multisig required');

  const action = flagStr(flags, 'action');
  if (action !== 'register' && action !== 'update') {
    throw new Error('--action must be "register" or "update"');
  }

  const vaultIndex = flagInt(flags, 'vault-index', 0)!;
  const merkleRoot = hex32(flagStr(flags, 'merkle-root') ?? '', 'merkle-root');
  const policyDataHash = hex32(flagStr(flags, 'policy-hash') ?? '', 'policy-hash');

  const multisigPda = new PublicKey(multisigAddress);
  const programId = new PublicKey(common.policyRegistryProgramId);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: vaultIndex });

  const snap = await readMultisig(conn, multisigPda);
  const newTxIndex = snap.nextTransactionIndex;

  let policyIx: TransactionInstruction;
  let policyPda: PublicKey;

  if (action === 'register') {
    const policyIdHex = flagStr(flags, 'policy-id') ?? randomHex32();
    const policyIdBytes = hex32(policyIdHex, 'policy-id');
    const built = buildRegisterPolicyMultisigIx({
      authority: signer.publicKey,
      multisigPda,
      vaultPda,
      vaultIndex,
      policyIdBytes,
      merkleRoot,
      policyDataHash,
      programId,
    });
    policyIx = built.instruction;
    policyPda = built.policyPda;
    console.log(`policy_id (32-byte)  : ${policyIdHex}`);
    console.log(`policy PDA           : ${policyPda.toBase58()}`);
  } else {
    const policyPdaArg = flagStr(flags, 'policy-pda');
    if (!policyPdaArg) throw new Error('--policy-pda required for update');
    policyPda = new PublicKey(policyPdaArg);
    policyIx = buildUpdatePolicyMultisigIx({
      authority: signer.publicKey,
      multisigPda,
      vaultPda,
      vaultIndex,
      policyPda,
      merkleRoot,
      policyDataHash,
      programId,
    });
  }

  const { blockhash } = await conn.getLatestBlockhash();
  const transactionMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: [policyIx],
  });

  const vaultTxIx = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: newTxIndex,
    creator: signer.publicKey,
    vaultIndex,
    ephemeralSigners: 0,
    transactionMessage,
    memo: flagStr(flags, 'memo') ?? `${action}_policy via SDK CLI`,
  });

  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex: newTxIndex,
    creator: signer.publicKey,
  });

  const sig = await sendLegacyTx(conn, signer, [vaultTxIx, proposalIx]);

  const [transactionPda] = multisig.getTransactionPda({
    multisigPda,
    index: newTxIndex,
  });
  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: newTxIndex,
  });

  console.log(`tx index             : ${newTxIndex.toString()}`);
  console.log(`transaction PDA      : ${transactionPda.toBase58()}`);
  console.log(`proposal PDA         : ${proposalPda.toBase58()}`);
  console.log(`signature            : ${sig}`);

  let proposalRecordId: string | null = null;
  if (!common.skipCache) {
    const action_db = action === 'register' ? 'register_policy' : 'update_policy';
    const policyUuid = flagStr(flags, 'policy-uuid');
    const recorded = await postProposal(common.policyServiceUrl, {
      operator_id: signer.publicKey.toBase58(),
      multisig_address: multisigPda.toBase58(),
      transaction_index: Number(newTxIndex),
      transaction_pda: transactionPda.toBase58(),
      proposal_pda: proposalPda.toBase58(),
      action: action_db,
      policy_id: policyUuid,
      target_merkle_root: merkleRoot.toString('hex'),
      target_policy_hash: policyDataHash.toString('hex'),
      created_by: signer.publicKey.toBase58(),
    });
    if (recorded) {
      proposalRecordId = recorded.id;
      console.log(`cache mirror id      : ${recorded.id}`);
    }
  }

  return {
    transactionIndex: newTxIndex,
    transactionPda,
    proposalPda,
    policyPda,
    signature: sig,
    proposalRecordId,
  };
}

async function cmdProposePolicy(flags: Flags): Promise<void> {
  const common = commonArgs(flags);
  const conn = new Connection(common.rpcUrl, 'confirmed');
  const signer = loadKeypair(common.keypair);
  console.log('Aperture · Squads propose-policy');
  console.log('─────────────────────────────────');
  console.log(`signer (creator)     : ${signer.publicKey.toBase58()}`);
  await proposePolicyCore(conn, signer, flags, common);
}

// =====================================================================
// subcommand: approve
// =====================================================================

async function approveCore(
  conn: Connection,
  signer: Keypair,
  multisigPda: PublicKey,
  txIndex: bigint,
): Promise<{ signature: string; approvalCount: number; rejectionCount: number }> {
  const ix = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex: txIndex,
    member: signer.publicKey,
  });
  const sig = await sendLegacyTx(conn, signer, [ix]);

  const [proposalPda] = multisig.getProposalPda({
    multisigPda,
    transactionIndex: txIndex,
  });
  const proposalAcc = await multisig.accounts.Proposal.fromAccountAddress(
    conn,
    proposalPda,
  );
  return {
    signature: sig,
    approvalCount: proposalAcc.approved.length,
    rejectionCount: proposalAcc.rejected.length,
  };
}

async function cmdApprove(flags: Flags): Promise<void> {
  const common = commonArgs(flags);
  const multisigAddress = flagStr(flags, 'multisig');
  const txIndexFlag = flagStr(flags, 'tx-index');
  if (!multisigAddress) throw new Error('--multisig required');
  if (!txIndexFlag) throw new Error('--tx-index required');

  const conn = new Connection(common.rpcUrl, 'confirmed');
  const signer = loadKeypair(common.keypair);
  const multisigPda = new PublicKey(multisigAddress);
  const txIndex = BigInt(txIndexFlag);

  console.log('Aperture · Squads approve');
  console.log('─────────────────────────');
  console.log(`signer (member)      : ${signer.publicKey.toBase58()}`);

  const { signature, approvalCount, rejectionCount } = await approveCore(
    conn,
    signer,
    multisigPda,
    txIndex,
  );
  console.log(`signature            : ${signature}`);
  console.log(`approvals            : ${approvalCount}`);
  console.log(`rejections           : ${rejectionCount}`);

  const proposalId = flagStr(flags, 'proposal-id');
  if (proposalId && !common.skipCache) {
    const snap = await readMultisig(conn, multisigPda);
    const newStatus = approvalCount >= snap.threshold ? 'approved' : 'pending';
    const ok = await patchProposalStatus(common.policyServiceUrl, proposalId, {
      status: newStatus,
      approval_count: approvalCount,
      rejection_count: rejectionCount,
    });
    if (ok) console.log(`cache mirror         : ${newStatus}`);
  }
}

// =====================================================================
// subcommand: execute
// =====================================================================

async function executeCore(
  conn: Connection,
  signer: Keypair,
  multisigPda: PublicKey,
  txIndex: bigint,
): Promise<string> {
  const { instruction, lookupTableAccounts } =
    await multisig.instructions.vaultTransactionExecute({
      connection: conn,
      multisigPda,
      transactionIndex: txIndex,
      member: signer.publicKey,
    });
  return sendV0Tx(conn, signer, [instruction], lookupTableAccounts);
}

async function cmdExecute(flags: Flags): Promise<void> {
  const common = commonArgs(flags);
  const multisigAddress = flagStr(flags, 'multisig');
  const txIndexFlag = flagStr(flags, 'tx-index');
  if (!multisigAddress) throw new Error('--multisig required');
  if (!txIndexFlag) throw new Error('--tx-index required');

  const conn = new Connection(common.rpcUrl, 'confirmed');
  const signer = loadKeypair(common.keypair);
  const multisigPda = new PublicKey(multisigAddress);
  const txIndex = BigInt(txIndexFlag);

  console.log('Aperture · Squads execute');
  console.log('─────────────────────────');
  console.log(`signer (executor)    : ${signer.publicKey.toBase58()}`);

  const sig = await executeCore(conn, signer, multisigPda, txIndex);
  console.log(`signature            : ${sig}`);

  const proposalId = flagStr(flags, 'proposal-id');
  if (proposalId && !common.skipCache) {
    const ok = await patchProposalStatus(common.policyServiceUrl, proposalId, {
      status: 'executed',
      executed_tx: sig,
    });
    if (ok) console.log(`cache mirror         : executed`);
  }
}

// =====================================================================
// subcommand: auto-policy (propose + approve + execute, 1-of-1 friendly)
// =====================================================================

async function cmdAutoPolicy(flags: Flags): Promise<void> {
  const common = commonArgs(flags);
  const conn = new Connection(common.rpcUrl, 'confirmed');
  const signer = loadKeypair(common.keypair);

  console.log('Aperture · Squads auto-policy (propose + approve + execute)');
  console.log('────────────────────────────────────────────────────────────');
  console.log(`signer               : ${signer.publicKey.toBase58()}`);

  // 1. propose
  const proposed = await proposePolicyCore(conn, signer, flags, common);
  const multisigPda = new PublicKey(flagStr(flags, 'multisig')!);

  // 2. approve
  console.log('---');
  const { signature: approveSig, approvalCount } = await approveCore(
    conn,
    signer,
    multisigPda,
    proposed.transactionIndex,
  );
  console.log(`approve signature    : ${approveSig}`);
  console.log(`approvals            : ${approvalCount}`);

  // After approval, mirror approved status if record exists.
  if (proposed.proposalRecordId && !common.skipCache) {
    await patchProposalStatus(common.policyServiceUrl, proposed.proposalRecordId, {
      status: 'approved',
      approval_count: approvalCount,
    });
  }

  // 3. execute
  console.log('---');
  const execSig = await executeCore(conn, signer, multisigPda, proposed.transactionIndex);
  console.log(`execute signature    : ${execSig}`);

  if (proposed.proposalRecordId && !common.skipCache) {
    await patchProposalStatus(common.policyServiceUrl, proposed.proposalRecordId, {
      status: 'executed',
      executed_tx: execSig,
    });
    console.log(`cache mirror         : executed`);
  }

  console.log('────────────────────────────────────────────────────────────');
  console.log(`MULTISIG=${multisigPda.toBase58()}`);
  console.log(`TX_INDEX=${proposed.transactionIndex.toString()}`);
  console.log(`POLICY_PDA=${proposed.policyPda.toBase58()}`);
  console.log(`PROPOSE_SIG=${proposed.signature}`);
  console.log(`APPROVE_SIG=${approveSig}`);
  console.log(`EXECUTE_SIG=${execSig}`);
}

// =====================================================================
// dispatcher
// =====================================================================

function printUsage(): void {
  console.log(
    `Usage: tsx scripts/squads-cli.ts <subcommand> [flags]

Subcommands:
  lookup           --multisig <addr> [--vault-index 0]
  propose-policy   --multisig <addr> --action register|update
                   [--policy-id <hex32>] [--policy-pda <addr> for update]
                   --merkle-root <hex32> --policy-hash <hex32>
                   [--vault-index 0] [--memo "..."] [--policy-uuid <uuid>]
  approve          --multisig <addr> --tx-index <N> [--proposal-id <uuid>]
  execute          --multisig <addr> --tx-index <N> [--proposal-id <uuid>]
  auto-policy      [propose flags] (does propose + approve + execute)

Common flags:
  --keypair <file>             default ./.aperture-operator.json
  --rpc-url <url>              default https://api.devnet.solana.com
  --policy-service-url <url>   default http://localhost:3001
  --policy-registry-program <programId>
  --skip-cache                 skip policy-service mirror writes`,
  );
}

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  const flags = parseFlags(process.argv.slice(3));

  switch (subcommand) {
    case 'lookup':
      await cmdLookup(flags);
      break;
    case 'propose-policy':
      await cmdProposePolicy(flags);
      break;
    case 'approve':
      await cmdApprove(flags);
      break;
    case 'execute':
      await cmdExecute(flags);
      break;
    case 'auto-policy':
      await cmdAutoPolicy(flags);
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printUsage();
      break;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  if (process.env.DEBUG === '1' && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
