/**
 * scripts/squads-devnet-bind.ts
 *
 * UI-free end-to-end Squads V4 binding flow on Devnet:
 *
 *   1. Load (or generate) a Solana keypair → operator authority
 *   2. Top it up via the Devnet airdrop faucet if balance is too low
 *   3. Create a Squads V4 multisig with the operator as one signer plus
 *      any extra members passed in via --member
 *   4. Initialise the operator account on Aperture's policy-registry if
 *      it doesn't exist yet
 *   5. Submit set_multisig so the operator account points at the new
 *      vault PDA
 *   6. POST /api/v1/squads/binding to policy-service so the dashboard
 *      cache + audit log mirror what we just did on chain
 *
 * Run from repo root:
 *
 *   npx tsx scripts/squads-devnet-bind.ts \
 *       --keypair ./.aperture-operator.json \
 *       --member CBDjvUkZZ6ucrVGrU3vRraasTytha8oVg2NLCxAHE25b \
 *       --threshold 1
 *
 * If --keypair points at a path that doesn't exist, the script generates
 * a fresh keypair there. That's the safest default for local devnet
 * testing — no need to export a Phantom seed phrase.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';

// ----- argv parsing -------------------------------------------------------

interface Args {
  readonly keypair: string;
  readonly members: readonly string[];
  readonly threshold: number;
  readonly rpcUrl: string;
  readonly policyServiceUrl: string;
  readonly policyRegistryProgramId: string;
  readonly vaultIndex: number;
  readonly skipBind: boolean;
  readonly label?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Record<string, string | string[] | boolean> = {};
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (key === 'member') {
      const list = (args.member as string[]) ?? [];
      list.push(next!);
      args.member = list;
      i++;
    } else if (key === 'skip-bind') {
      args[key] = true;
    } else {
      args[key] = next!;
      i++;
    }
  }

  return {
    keypair: (args.keypair as string) ?? './.aperture-operator.json',
    members: (args.member as string[]) ?? [],
    threshold: args.threshold ? Number(args.threshold) : 1,
    rpcUrl:
      (args['rpc-url'] as string) ??
      process.env.SOLANA_RPC_URL ??
      'https://api.devnet.solana.com',
    policyServiceUrl:
      (args['policy-service-url'] as string) ??
      process.env.POLICY_SERVICE_URL ??
      'http://localhost:3001',
    policyRegistryProgramId:
      (args['policy-registry-program'] as string) ??
      process.env.POLICY_REGISTRY_PROGRAM ??
      'FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU',
    vaultIndex: args['vault-index'] ? Number(args['vault-index']) : 0,
    skipBind: args['skip-bind'] === true,
    label: args.label as string | undefined,
  };
}

// ----- helpers ------------------------------------------------------------

function loadOrGenerateKeypair(filePath: string): Keypair {
  const resolved = path.resolve(filePath);
  if (fs.existsSync(resolved)) {
    const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
    if (!Array.isArray(raw)) {
      throw new Error(`${resolved}: expected JSON array of bytes`);
    }
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(resolved, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`Generated new keypair → ${resolved}`);
  return kp;
}

async function ensureFunded(
  connection: Connection,
  keypair: Keypair,
  minLamports: number,
): Promise<void> {
  const balance = await connection.getBalance(keypair.publicKey);
  if (balance >= minLamports) {
    console.log(
      `Balance ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL — sufficient.`,
    );
    return;
  }
  const need = Math.max(minLamports - balance, 1 * LAMPORTS_PER_SOL);
  console.log(
    `Balance ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL is too low. Requesting airdrop of ${
      need / LAMPORTS_PER_SOL
    } SOL…`,
  );
  // Devnet faucet limits a single airdrop to 2 SOL; loop until we hit
  // the target. Public faucet can be flaky, surface a clear message.
  let topped = balance;
  while (topped < minLamports) {
    const chunk = Math.min(2 * LAMPORTS_PER_SOL, minLamports - topped);
    try {
      const sig = await connection.requestAirdrop(keypair.publicKey, chunk);
      await connection.confirmTransaction(sig, 'confirmed');
      topped = await connection.getBalance(keypair.publicKey);
      console.log(
        `  airdrop confirmed → balance ${(topped / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('');
      console.error('Devnet RPC airdrop is rate-limited or down.');
      console.error('');
      console.error('Manual airdrop options:');
      console.error(`  1. https://faucet.solana.com → paste ${keypair.publicKey.toBase58()}`);
      console.error(`  2. https://faucet.quicknode.com/solana/devnet`);
      console.error(`  3. Send SOL from another devnet wallet to ${keypair.publicKey.toBase58()}`);
      console.error('');
      console.error('Re-run the same command after the keypair is funded — the keypair file');
      console.error('was saved so the script will reuse it instead of generating a new one.');
      console.error('');
      throw new Error(`Airdrop failed: ${msg}`);
    }
  }
}

// ----- Aperture set_multisig instruction ----------------------------------
//
// We re-implement the same builder dashboard/src/lib/anchor-instructions.ts
// uses, so the script is self-contained — no client SDK install needed
// for runners that don't have the dashboard checked out.

const SET_MULTISIG_DISCRIMINATOR = Buffer.from([251, 6, 245, 35, 115, 42, 77, 186]);
const INITIALIZE_OPERATOR_DISCRIMINATOR = Buffer.from([
  155, 33, 216, 254, 233, 227, 175, 212,
]);

function deriveOperatorPda(
  authority: PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('operator'), authority.toBuffer()],
    programId,
  )[0];
}

function deriveSquadsVaultPda(
  multisigKey: PublicKey,
  vaultIndex: number,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('multisig'),
      multisigKey.toBuffer(),
      Buffer.from('vault'),
      Buffer.from([vaultIndex]),
    ],
    new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'),
  )[0];
}

function buildInitializeOperatorIx(
  authority: PublicKey,
  programId: PublicKey,
  operatorName: string,
): TransactionInstruction {
  const operatorPda = deriveOperatorPda(authority, programId);
  const nameBytes = Buffer.from(operatorName, 'utf-8');
  const data = Buffer.alloc(8 + 4 + nameBytes.length);
  INITIALIZE_OPERATOR_DISCRIMINATOR.copy(data, 0);
  data.writeUInt32LE(nameBytes.length, 8);
  nameBytes.copy(data, 12);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildSetMultisigIx(
  authority: PublicKey,
  squadsMultisig: PublicKey,
  vaultIndex: number,
  programId: PublicKey,
): TransactionInstruction {
  const operatorPda = deriveOperatorPda(authority, programId);
  const data = Buffer.alloc(8 + 1);
  SET_MULTISIG_DISCRIMINATOR.copy(data, 0);
  data.writeUInt8(vaultIndex, 8);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: operatorPda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: squadsMultisig, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ----- main ---------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  console.log('Aperture · Squads V4 Devnet binding');
  console.log('───────────────────────────────────');

  const connection = new Connection(args.rpcUrl, 'confirmed');
  const operator = loadOrGenerateKeypair(args.keypair);
  console.log(`Operator authority    : ${operator.publicKey.toBase58()}`);

  // Estimated rent: multisig ~0.025 SOL + 2x tx fees + safety. 0.05 SOL
  // is plenty; we ask for a full SOL so the same keypair can also sign
  // the set_multisig tx without re-airdropping.
  await ensureFunded(connection, operator, 1 * LAMPORTS_PER_SOL);

  // 1. Build the member list. Operator is always a member; extra
  //    --member values are added with full permissions. Threshold
  //    defaults to 1.
  const members = [
    {
      key: operator.publicKey,
      permissions: multisig.types.Permissions.all(),
    },
    ...args.members.map((addr) => ({
      key: new PublicKey(addr),
      permissions: multisig.types.Permissions.all(),
    })),
  ];
  if (members.length < args.threshold) {
    throw new Error(
      `Threshold ${args.threshold} cannot exceed member count ${members.length}.`,
    );
  }
  console.log(`Members (${members.length})         :`);
  members.forEach((m, i) =>
    console.log(`  [${i}] ${m.key.toBase58()}${i === 0 ? ' (operator)' : ''}`),
  );
  console.log(`Threshold             : ${args.threshold} of ${members.length}`);

  // 2. Derive Squads PDAs and pull the program-config treasury.
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig =
    await multisig.accounts.ProgramConfig.fromAccountAddress(
      connection,
      programConfigPda,
    );
  const treasury = programConfig.treasury;
  console.log(`Multisig PDA          : ${multisigPda.toBase58()}`);

  // 3. Fire multisigCreateV2.
  const createIx = await multisig.instructions.multisigCreateV2({
    createKey: createKey.publicKey,
    creator: operator.publicKey,
    multisigPda,
    configAuthority: null,
    timeLock: 0,
    members,
    threshold: args.threshold,
    treasury,
    rentCollector: null,
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const createTx = new Transaction({
    feePayer: operator.publicKey,
    recentBlockhash: blockhash,
  }).add(createIx);
  createTx.sign(operator, createKey);
  const createSig = await connection.sendRawTransaction(createTx.serialize());
  await connection.confirmTransaction(createSig, 'confirmed');
  console.log(`Multisig created      : ${createSig}`);

  // 4. Aperture: ensure operator account, then set_multisig.
  const programId = new PublicKey(args.policyRegistryProgramId);
  const operatorPda = deriveOperatorPda(operator.publicKey, programId);
  const operatorInfo = await connection.getAccountInfo(operatorPda);

  const apertureIxs: TransactionInstruction[] = [];
  if (!operatorInfo) {
    console.log('Operator account      : missing → adding initialize_operator');
    apertureIxs.push(
      buildInitializeOperatorIx(
        operator.publicKey,
        programId,
        args.label ?? `Aperture op ${operator.publicKey.toBase58().slice(0, 6)}`,
      ),
    );
  } else {
    console.log('Operator account      : exists, reusing');
  }
  apertureIxs.push(
    buildSetMultisigIx(operator.publicKey, multisigPda, args.vaultIndex, programId),
  );

  const { blockhash: bindBlockhash } = await connection.getLatestBlockhash();
  const apertureTx = new Transaction({
    feePayer: operator.publicKey,
    recentBlockhash: bindBlockhash,
  });
  apertureIxs.forEach((ix) => apertureTx.add(ix));
  apertureTx.sign(operator);
  const apertureSig = await connection.sendRawTransaction(apertureTx.serialize());
  await connection.confirmTransaction(apertureSig, 'confirmed');
  console.log(`set_multisig signed   : ${apertureSig}`);

  const vaultPda = deriveSquadsVaultPda(multisigPda, args.vaultIndex);
  console.log(`Vault PDA (signer)    : ${vaultPda.toBase58()}`);

  // 5. Mirror the binding into policy-service. Skip when --skip-bind is
  //    passed (useful when the policy-service isn't running locally).
  if (args.skipBind) {
    console.log('Skipping policy-service cache (--skip-bind passed).');
  } else {
    const url = `${args.policyServiceUrl.replace(/\/$/, '')}/api/v1/squads/binding`;
    const body = {
      operator_id: operator.publicKey.toBase58(),
      multisig_address: multisigPda.toBase58(),
      vault_index: args.vaultIndex,
      label: args.label,
      bind_tx_signature: apertureSig,
      actor: operator.publicKey.toBase58(),
    };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !json.success) {
        console.warn(
          `policy-service cache write failed (${res.status}): ${json.error ?? 'unknown'} — you can retry by re-running the script with --skip-bind off, or call POST /api/v1/squads/binding manually.`,
        );
      } else {
        console.log(`policy-service cache  : OK (${url})`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `policy-service unreachable: ${msg} — start it with 'POSTGRES_DB=aperture_policy npm run dev:policy' and POST manually if you want the cache populated.`,
      );
    }
  }

  console.log('───────────────────────────────────');
  console.log('Done. Use the address below in the dashboard or re-run with');
  console.log('--keypair pointing at the same JSON to manage the binding.');
  console.log('');
  console.log(`MULTISIG_PDA=${multisigPda.toBase58()}`);
  console.log(`VAULT_PDA=${vaultPda.toBase58()}`);
  console.log(`OPERATOR_AUTHORITY=${operator.publicKey.toBase58()}`);
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
