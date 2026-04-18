import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { FlowTabs, type Flow } from '@/components/integrate/FlowTabs';
import { readSample, sliceSample } from '@/lib/code-samples';

export const dynamic = 'force-dynamic';

function buildFlows(): readonly Flow[] {
  const x402Sample = readSample('sdk/agent/src/x402-payer.ts');
  const mppSample = readSample('sdk/agent/src/mpp-payer.ts');
  const hookSample = readSample('scripts/init-hook-v3.ts');
  const compressedSample = readSample('scripts/create-compressed-mint.ts');
  const registerMultisig = readSample('programs/policy-registry/src/instructions/register_policy_multisig.rs');
  const guestProver = readSample('circuits/payment-prover/methods/guest/src/main.rs');
  const proverRs = readSample('services/prover-service/src/prover.rs');

  const proverUrl = process.env.NEXT_PUBLIC_PROVER_SERVICE_URL ?? 'http://localhost:3003';
  const complianceUrl = process.env.NEXT_PUBLIC_COMPLIANCE_API_URL ?? 'http://localhost:3002';
  const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const vusdcMint = process.env.NEXT_PUBLIC_VUSDC_MINT ?? 'E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar';

  return [
    {
      id: 'x402',
      label: 'x402 Payment Protocol',
      tagline: 'HTTP 402 challenge/response flow: endpoint returns a payment requirement, client transfers USDC on Solana Devnet, then retries with an x-402-payment header that carries the ZK proof hash.',
      prerequisites: [
        'Solana wallet funded with devnet USDC (mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)',
        'Prover service reachable (NEXT_PUBLIC_PROVER_SERVICE_URL)',
        'Compliance API reachable (NEXT_PUBLIC_COMPLIANCE_API_URL)',
        'Operator has an active policy that allows the "x402" endpoint category',
      ],
      steps: [
        {
          title: 'Hit the protected endpoint, receive 402',
          description: 'An unauthenticated GET returns HTTP 402 and a paymentRequirement envelope describing the token, amount and recipient.',
          code: {
            source: `GET ${complianceUrl}/api/v1/compliance/protected-report?operator_id=<operator>
\n→ 402 Payment Required
{
  "paymentRequirement": {
    "token": "${usdcMint}",
    "amount": "1000000",
    "recipient": "<recipient-wallet>",
    "description": "Aperture Compliance Report - 1 USDC"
  }
}`,
            sourcePath: null,
            language: 'http',
          },
        },
        {
          title: 'Generate a ZK proof of compliance',
          description: 'Submit the policy + payment context to the prover. The 255 KB STARK receipt is verified locally before returning.',
          code: sliceSample(readSample('services/prover-service/src/prover.rs'), 13, 75),
        },
        {
          title: 'Execute the USDC transfer on Solana Devnet',
          description: 'Send the payment transaction and confirm. The returned signature is the proof-of-payment referenced in the retry header.',
          code: sliceSample(x402Sample, 1, Math.min(80, x402Sample.source.split('\n').length)),
        },
        {
          title: 'Retry with x-402-payment header',
          description: 'Base64 JSON of { txSignature, payer, zkProofHash } identifies the payment. The compliance API cross-references the on-chain TX and proof record, then returns the protected resource.',
          code: {
            source: `const proofHeader = Buffer.from(JSON.stringify({
  txSignature,
  payer: wallet.publicKey.toBase58(),
  zkProofHash: proof.proof_hash,
})).toString('base64');

const paid = await fetch(endpoint, {
  headers: { 'x-402-payment': proofHeader },
});
// → 200 OK with the compliance report`,
            sourcePath: null,
            language: 'typescript',
          },
        },
      ],
      verification: {
        description: 'Confirm the prover endpoint, policy categories and on-chain verification succeed end-to-end.',
        command: `curl -s ${proverUrl}/health && \\\n  curl -s ${complianceUrl}/api/v1/compliance/protected-report?operator_id=<operator> -i | head -n 20`,
      },
      troubleshooting: [
        {
          issue: '402 is returned even after retry',
          fix: 'Verify the txSignature has been confirmed on Devnet and that the zkProofHash matches a proof record submitted to the compliance API.',
        },
        {
          issue: 'Prover returns HTTP 500',
          fix: 'Check prover-service logs for `RISC Zero zkVM` errors. On Apple Silicon under amd64 emulation proving takes ~45s — ensure your client timeout is >90s.',
        },
        {
          issue: 'Insufficient USDC balance',
          fix: 'Fund the wallet with devnet USDC (circle faucet or transfer from another devnet account).',
        },
      ],
    },

    {
      id: 'mpp',
      label: 'MPP (Stripe)',
      tagline: 'Machine Payments Protocol: HTTP 402 challenge → Stripe PaymentIntent confirm → ZK proof → retry with x-mpp-credential. Dual settlement: Stripe PaymentIntent metadata + Solana Devnet verify_payment_proof.',
      prerequisites: [
        'Stripe test keys configured on the compliance API (STRIPE_SECRET_KEY, MPP_SECRET_KEY)',
        'Solana wallet with devnet SOL for proof verification TX fees',
        'Operator has an active policy that allows the "mpp" endpoint category',
      ],
      steps: [
        {
          title: 'GET the protected endpoint, receive mppChallenge',
          description: 'Server issues an HTTP 402 with WWW-Authenticate and a Stripe PaymentIntent client_secret bound to the challenge.',
          code: {
            source: `GET ${complianceUrl}/api/v1/compliance/mpp-report?operator_id=<operator>
\n→ 402 Payment Required
WWW-Authenticate: MPP realm="aperture"
{
  "mppChallenge": {
    "id": "<challenge-id>",
    "clientSecret": "pi_***_secret_***",
    "amount": 50,
    "currency": "usd"
  }
}`,
            sourcePath: null,
            language: 'http',
          },
        },
        {
          title: 'Confirm the PaymentIntent on the client',
          description: 'Use Stripe.js with the client_secret. In test mode pm_card_visa succeeds deterministically.',
          code: sliceSample(mppSample, 1, Math.min(100, mppSample.source.split('\n').length)),
        },
        {
          title: 'Generate ZK proof and verify on Solana',
          description: 'After Stripe confirms, the client generates a proof via the prover and the compliance API submits the verify_payment_proof instruction on Devnet.',
          code: {
            source: `curl -X POST ${proverUrl}/prove \\
  -H "Content-Type: application/json" \\
  -d '{"policy_id": "<uuid>", "operator_id": "<wallet>", "payment_endpoint_category": "mpp", ...}'`,
            sourcePath: null,
            language: 'bash',
          },
        },
        {
          title: 'Retry with x-mpp-credential',
          description: 'Base64 JSON { challengeId, paymentIntentId }. Server validates the PI metadata, looks up the proof record, and returns the protected resource plus a Payment-Receipt header.',
          code: {
            source: `const credential = Buffer.from(JSON.stringify({
  challengeId: challenge.id,
  paymentIntentId: pi.id,
})).toString('base64');

await fetch(endpoint, {
  headers: { 'x-mpp-credential': credential },
});`,
            sourcePath: null,
            language: 'typescript',
          },
        },
      ],
      verification: {
        description: 'Confirm the PaymentIntent status is `succeeded` and the mpp_version/mpp_resource metadata is set.',
        command: `stripe payment_intents retrieve <payment_intent_id>\n# expected status: succeeded, metadata.mpp_version present`,
      },
      troubleshooting: [
        {
          issue: 'Stripe returns `payment_intent_unexpected_state`',
          fix: 'The client_secret has already been used. Request a fresh 402 challenge.',
        },
        {
          issue: 'Proof record not found during retry',
          fix: 'The zkProofHash must be submitted to the compliance API *before* retrying. Confirm the POST /proof-records call succeeded.',
        },
      ],
    },

    {
      id: 'transfer-hook',
      label: 'SPL Token-2022 Transfer Hook',
      tagline: 'vUSDC is an SPL Token-2022 mint with an on-chain transfer hook. The hook program rejects any transfer unless the sender has a verified ComplianceStatus PDA for the active operator policy.',
      prerequisites: [
        'SPL Token-2022 toolchain (solana-cli 2.x)',
        'Deployed transfer hook program (NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM)',
        'vUSDC mint already created (NEXT_PUBLIC_VUSDC_MINT)',
        'Operator + policy already registered on-chain',
      ],
      steps: [
        {
          title: 'Initialize the ExtraAccountMetaList',
          description: 'The hook resolves additional accounts (HookConfig, ComplianceStatus PDA, Verifier program) via the ExtraAccountMetaList PDA. This script initializes it once per mint.',
          code: sliceSample(hookSample, 1, Math.min(120, hookSample.source.split('\n').length)),
        },
        {
          title: 'Mint vUSDC with the transfer hook extension enabled',
          description: 'Mint authority issues tokens. Any subsequent transfer invokes the hook program and resolves the extra account metas automatically.',
          code: {
            source: `# vUSDC mint: ${vusdcMint}\nspl-token create-account ${vusdcMint} --url devnet\nspl-token mint ${vusdcMint} 100 --url devnet`,
            sourcePath: null,
            language: 'bash',
          },
        },
        {
          title: 'Transfer vUSDC — hook runs, allow/reject based on ComplianceStatus',
          description: 'If the sender has a verified ComplianceStatus PDA (created by verify_payment_proof), the transfer succeeds. Otherwise the hook returns `no compliance status`.',
          code: {
            source: `spl-token transfer ${vusdcMint} 1 <recipient> --url devnet --fund-recipient\n# Hook invocation in TX logs:\n# Program log: Transfer hook check for <wallet>\n# Program log: Hook OK` ,
            sourcePath: null,
            language: 'bash',
          },
        },
      ],
      verification: {
        description: 'Inspect the program logs for the transfer TX. A compliant transfer produces `Hook OK`; a blocked one produces `Hook REJECTED: no compliance status`.',
        command: `solana confirm -v <tx_signature> --url devnet | grep "Program log"`,
      },
      troubleshooting: [
        {
          issue: 'Transfer fails with `Hook REJECTED`',
          fix: 'Generate a ZK proof for the sender and submit verify_payment_proof so the ComplianceStatus PDA is populated.',
        },
        {
          issue: 'ExtraAccountMetaList account does not exist',
          fix: 'Run scripts/init-hook-v3.ts against your mint authority wallet before issuing transfers.',
        },
      ],
    },

    {
      id: 'compressed',
      label: 'Light Protocol ZK Compression',
      tagline: 'Store attestations as Light Protocol compressed tokens — per-proof rent cost drops from ~0.001462 SOL to ~0.00001 SOL (~146× cheaper). Ideal for high-volume proof archives.',
      prerequisites: [
        'Helius devnet RPC endpoint (LIGHT_RPC_URL)',
        'Payer keypair funded with devnet SOL',
        'Light Protocol SDK installed (already a dependency of the agent service)',
      ],
      steps: [
        {
          title: 'Create the compressed attestation mint',
          description: 'One-time setup per operator. The mint address is stored in NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT.',
          code: sliceSample(compressedSample, 1, Math.min(120, compressedSample.source.split('\n').length)),
        },
        {
          title: 'Mint a compressed attestation per proof',
          description: 'For each verified proof, the agent mints a compressed token into the operator ATA. Recipients can transfer these tokens like normal SPL tokens through Light Protocol’s state compression primitives.',
          code: {
            source: `// From sdk/agent/src/agent.ts\nawait mintCompressedAttestation({\n  mint: process.env.NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT!,\n  payer,\n  destination: operatorPublicKey,\n  amount: 1n,\n  metadata: { proof_hash: proof.proof_hash, operator_id: operatorId },\n});`,
            sourcePath: null,
            language: 'typescript',
          },
        },
      ],
      verification: {
        description: 'Query the compressed token state via Helius and confirm the token is owned by the operator.',
        command: `curl -s "${process.env.NEXT_PUBLIC_LIGHT_RPC_URL ?? '$LIGHT_RPC_URL'}" -X POST \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"getCompressedTokenAccountsByOwner","params":{"owner":"<operator>"}}'`,
      },
      troubleshooting: [
        {
          issue: 'Helius returns 429 / rate limited',
          fix: 'Add an API key to LIGHT_RPC_URL or upgrade your Helius plan. Devnet traffic is throttled.',
        },
        {
          issue: 'Compressed mint not found',
          fix: 'Re-run scripts/create-compressed-mint.ts and update NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT.',
        },
      ],
    },

    {
      id: 'squads',
      label: 'Squads V4 Multisig',
      tagline: 'Bind a policy to a Squads V4 vault. Policy updates now require multisig approval — the Policy Registry program verifies the caller against the stored vault PDA.',
      prerequisites: [
        'Squads V4 multisig created via the Squads app (or CLI)',
        'Policy Registry program deployed (NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM)',
        'Operator already registered',
      ],
      steps: [
        {
          title: 'Register a policy with multisig binding',
          description: 'The register_policy_multisig instruction stores the Squads vault PDA on the Policy account. All subsequent update/deactivate instructions verify the signer matches.',
          code: sliceSample(registerMultisig, 1, Math.min(120, registerMultisig.source.split('\n').length)),
        },
        {
          title: 'Propose a policy update via Squads',
          description: 'Build the update_policy_multisig instruction, submit it to Squads as a transaction proposal, and collect signatures from the multisig members.',
          code: {
            source: `# Using @sqds/multisig TypeScript SDK\nconst ix = await program.methods\n  .updatePolicyMultisig(...)\n  .accounts({ policy: policyPda, vault: vaultPda, ... })\n  .instruction();\n\nawait squads.createTransaction({ multisig, instructions: [ix] });`,
            sourcePath: null,
            language: 'typescript',
          },
        },
        {
          title: 'Execute once threshold signatures collected',
          description: 'Squads executes the proposed TX. The Policy Registry program verifies the vault PDA, applies the update, and bumps the policy version.',
          code: {
            source: `await squads.executeTransaction({ multisig, transaction: txPda });`,
            sourcePath: null,
            language: 'typescript',
          },
        },
      ],
      verification: {
        description: 'Inspect the policy account and confirm the vault PDA matches your multisig.',
        command: `solana account <policy_pda> --url devnet --output json | jq '.account.data'`,
      },
      troubleshooting: [
        {
          issue: 'Update fails with UnauthorizedMultisig',
          fix: 'The signer must be the Squads vault PDA stored on the policy. Run the TX through the Squads program rather than signing directly.',
        },
        {
          issue: 'Squads TX stuck pending',
          fix: 'Verify the multisig threshold has been reached. Missing signatures block execution.',
        },
      ],
    },

    {
      id: 'risc0',
      label: 'RISC Zero Custom Circuit',
      tagline: 'Write your own guest program that consumes a policy + event, runs inside the zkVM and commits a journal. Aperture’s prover-service wraps this in a reusable HTTP contract.',
      prerequisites: [
        'rzup installed (rust toolchain + r0vm ≥ 1.2.6)',
        'cargo-risczero installed',
        'Familiarity with RISC Zero guest/host layout (see circuits/payment-prover/)',
      ],
      steps: [
        {
          title: 'Write the guest program',
          description: 'The guest reads its input via env::read(), performs the compliance check, and commits the public journal via env::commit().',
          code: sliceSample(guestProver, 1, Math.min(120, guestProver.source.split('\n').length)),
        },
        {
          title: 'Host-side proving',
          description: 'default_prover() runs the guest inside the zkVM. The receipt contains both the cryptographic STARK and the committed journal. Aperture serializes it via bincode for HTTP transport.',
          code: sliceSample(proverRs, 1, Math.min(80, proverRs.source.split('\n').length)),
        },
        {
          title: 'Decode the journal and submit on-chain',
          description: 'Parse the journal into your typed output, then submit the receipt hash + journal_digest + image_id to the Solana verifier program.',
          code: {
            source: `// journal decode (Rust host)\nlet output: ProverOutput = receipt.journal.decode()?;\n\n// send to verifier\nverify_payment_proof(\n  receipt_hash,\n  journal_digest,\n  image_id,\n  receipt_bytes,\n)`,
            sourcePath: null,
            language: 'rust',
          },
        },
      ],
      verification: {
        description: 'Run `cargo test -p <your-host-crate>` — the host performs a local receipt.verify() which fails if the journal doesn’t match the image_id.',
        command: `cargo test --release -p aperture-prover-service`,
      },
      troubleshooting: [
        {
          issue: '`Your installation of the r0vm server is not compatible`',
          fix: 'The local r0vm version must match the risc0-zkvm crate version in your Cargo.toml. Run `rzup install r0vm <matching-version>`.',
        },
        {
          issue: 'Journal decode fails',
          fix: 'Ensure the struct you read on the host is byte-compatible with what the guest committed. `serde_json` / bincode must agree across host and guest.',
        },
        {
          issue: 'Proving is slow on Apple Silicon Docker',
          fix: 'Run the prover natively on macOS for dev (5s per proof). Use the Docker build (linux/amd64 Rosetta) for prod parity only.',
        },
      ],
    },
  ];
}

export default function IntegratePage() {
  const flows = buildFlows();
  return (
    <main className="relative min-h-screen bg-[#000000] flex flex-col">
      <Navbar />
      <section className="relative z-10 pt-28 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="mb-10">
            <h1 className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 mb-2">Integrate</h1>
            <p className="text-sm text-amber-400/75 max-w-2xl leading-relaxed">
              Step-by-step integration flows for the six Aperture surfaces. Code blocks are sourced directly from the repository — no synthetic examples.
            </p>
          </div>
          <FlowTabs flows={flows} />
        </div>
      </section>
      <Footer />
    </main>
  );
}
