/**
 * Full-lifecycle integration test: drives the entire third-party flow from
 * scratch through the SDK ONLY, never touching the Aperture dashboard.
 *
 *   1. Fresh Solana keypair, airdropped SOL.
 *   2. SDK.createPolicy → policy-service POST /policies.
 *   3. SDK.anchorPolicy → policy_registry.initialize_operator + register_policy
 *      on Solana devnet, then PATCH /onchain-confirmation.
 *   4. Existing-wallet token funding (the fresh wallet has no USDC; we send
 *      from the funded test wallet whose AGENT_WALLET_PRIVATE_KEY is in env).
 *   5. payX402 → real verify_payment_proof_v2_with_transfer on devnet.
 *   6. createBatchAttestation → compliance-api batch + on-chain
 *      verify_batch_attestation.
 *   7. Assert audit URL + Solana Explorer URL build correctly.
 *
 * Required env (see tests/integration/env.ts):
 *   SOLANA_RPC_URL, POLICY_SERVICE_URL, PROVER_SERVICE_URL, COMPLIANCE_API_URL,
 *   AGENT_WALLET_PRIVATE_KEY (a funded wallet that will be used as the USDC
 *                             funder for the freshly-minted operator)
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { ApertureClient } from '../../src/index.js';
import { buildConnection, loadIntegrationEnv, type IntegrationEnv } from './env.js';

const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const ONE_USDC_LAMPORTS = 1_000_000;

describe('full lifecycle: fresh wallet → policy → on-chain anchor → x402 → batch attestation', () => {
  let env: IntegrationEnv;
  let connection: Connection;
  let freshWallet: Keypair;
  let funder: Keypair;
  let client: ApertureClient;

  beforeAll(async () => {
    env = loadIntegrationEnv();
    connection = buildConnection(env);
    funder = env.wallet;
    freshWallet = Keypair.generate();
    client = new ApertureClient({
      wallet: freshWallet,
      connection,
      policyServiceUrl: env.policyServiceUrl,
      proverServiceUrl: env.proverServiceUrl,
      complianceApiUrl: env.complianceApiUrl,
      dashboardUrl: 'http://localhost:5175',
      cluster: 'devnet',
    });
    // Move some SOL from the funder to the fresh wallet so it can pay fees
    // for initialize_operator + register_policy + verify+transfer + batch.
    await transferSol(connection, funder, freshWallet.publicKey, 0.05 * 1_000_000_000);
    // Move enough USDC for the test (3 USDC: x402 sends 1, headroom for any
    // re-runs in the same window).
    await transferUsdc(connection, funder, freshWallet.publicKey, 3 * ONE_USDC_LAMPORTS);
  }, 90_000);

  it(
    'runs the entire SDK-only flow',
    async () => {
      console.log('fresh operator:', client.operatorId);

      // ---- 1. operator not initialized on-chain yet --------------------
      expect(await client.operator.operatorExists()).toBe(false);

      // ---- 2. createAndAnchorPolicy ------------------------------------
      const recipient = Keypair.generate().publicKey;
      const anchor = await client.createAndAnchorPolicy({
        operator_id: client.operatorId,
        name: 'sdk-e2e-' + Date.now().toString(36),
        description: 'SDK lifecycle test',
        max_daily_spend: 10,
        max_per_transaction: 5,
        allowed_endpoint_categories: ['x402'],
        blocked_addresses: [],
        token_whitelist: [USDC_MINT],
        time_restrictions: [],
        is_active: true,
      });
      expect(anchor.operation).toBe('register');
      expect(anchor.txSignature.length).toBeGreaterThan(0);
      expect(anchor.onchainPda.length).toBeGreaterThan(0);
      console.log('anchored policy:', anchor.policyId);
      console.log('anchor tx:', client.audit.explorerTx(anchor.txSignature));

      // operator PDA must exist now
      expect(await client.operator.operatorExists()).toBe(true);

      // ---- 3. loadActivePolicy reads it back ---------------------------
      const policy = await client.loadActivePolicy();
      expect(policy.id).toBe(anchor.policyId);
      expect(policy.onchainPda).toBe(anchor.onchainPda);
      expect(policy.tokenWhitelist).toContain(USDC_MINT);

      // ---- 4. pay an x402 endpoint with this freshly-anchored policy ---
      // We spin up the protected-report endpoint locally via compliance-api
      // bound to the fresh operator. The recipient is whatever the
      // compliance-api returns in its 402 challenge — out of our hands.
      const endpoint = `${env.complianceApiUrl}/api/v1/compliance/protected-report?operator_id=${client.operatorId}`;
      const payResult = await client.payX402(endpoint, policy);

      expect(payResult.txSignature.length).toBeGreaterThan(0);
      expect(payResult.amountLamports).toBeGreaterThan(0);
      expect(payResult.response.ok).toBe(true);

      // Recording on compliance-api should have happened automatically.
      expect(payResult.recording).not.toBeNull();
      expect(payResult.recording?.proofRowId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      console.log('paid x402 tx:', client.audit.explorerTx(payResult.txSignature));
      console.log('proof row:', payResult.recording?.proofRowId);
      console.log('proof audit URL:', client.audit.proofUrl(payResult.recording!.proofRowId));

      // ---- 5. batch attestation aggregating the just-recorded proof ----
      const batch = await client.createBatchAttestation({
        periodStart: new Date(Date.now() - 5 * 60_000),
        periodEnd: new Date(),
      });
      expect(batch.txSignature.length).toBeGreaterThan(0);
      expect(batch.attestationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(batch.totalPayments).toBeGreaterThanOrEqual(1);
      console.log('batch tx:', client.audit.explorerTx(batch.txSignature));
      console.log('attestation audit URL:', client.audit.attestationUrl(batch.attestationId));

      // ---- 6. audit links are well-formed strings ----------------------
      expect(client.audit.proofUrl(payResult.recording!.proofRowId)).toContain('/audit/');
      expect(client.audit.attestationUrl(batch.attestationId)).toContain('/audit/');
      expect(client.audit.explorerTx(payResult.txSignature)).toMatch(
        /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet$/,
      );
    },
    600_000,
  );
});

async function transferSol(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  lamports: number,
): Promise<void> {
  const { SystemProgram } = await import('@solana/web3.js');
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports }),
  );
  tx.feePayer = from.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(from);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
}

async function transferUsdc(
  connection: Connection,
  from: Keypair,
  to: PublicKey,
  amountLamports: number,
): Promise<void> {
  const mint = new PublicKey(USDC_MINT);
  const fromAta = await getAssociatedTokenAddress(mint, from.publicKey, false, TOKEN_PROGRAM_ID);
  const toAta = await getAssociatedTokenAddress(mint, to, false, TOKEN_PROGRAM_ID);
  const tx = new Transaction();
  if (!(await connection.getAccountInfo(toAta))) {
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        from.publicKey,
        toAta,
        to,
        mint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  tx.add(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      from.publicKey,
      amountLamports,
      6,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  tx.feePayer = from.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.sign(from);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
}
