/**
 * Light Protocol ZK Compression integration.
 * Provides compressed attestation token minting and cost comparison utilities.
 */
import { config } from './config';

export interface CompressionCostComparison {
  readonly regularAccountRentLamports: number;
  readonly compressedTokenCostLamports: number;
  readonly savingsPercent: number;
  readonly savingsMultiplier: number;
}

// Solana rent costs for Aperture account types (in lamports)
// ProofRecord: 8 (disc) + 170 (fields) = 178 bytes -> rent exempt = ~1,461,600 lamports
// AttestationRecord: 8 + 158 = 166 bytes -> rent exempt = ~1,372,800 lamports
const PROOF_RECORD_RENT_LAMPORTS = 1_461_600;
const ATTESTATION_RECORD_RENT_LAMPORTS = 1_372_800;

// Compressed token cost: ~10,000 lamports per mint (tx fee + state tree update, measured on devnet)
const COMPRESSED_TOKEN_COST_LAMPORTS = 10_000;

export function getProofRecordCostComparison(): CompressionCostComparison {
  const regular = PROOF_RECORD_RENT_LAMPORTS;
  const compressed = COMPRESSED_TOKEN_COST_LAMPORTS;
  return {
    regularAccountRentLamports: regular,
    compressedTokenCostLamports: compressed,
    savingsPercent: Math.round((1 - compressed / regular) * 100),
    savingsMultiplier: Math.round(regular / compressed),
  };
}

export function getAttestationRecordCostComparison(): CompressionCostComparison {
  const regular = ATTESTATION_RECORD_RENT_LAMPORTS;
  const compressed = COMPRESSED_TOKEN_COST_LAMPORTS;
  return {
    regularAccountRentLamports: regular,
    compressedTokenCostLamports: compressed,
    savingsPercent: Math.round((1 - compressed / regular) * 100),
    savingsMultiplier: Math.round(regular / compressed),
  };
}

export function lamportsToSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(6);
}

export function isLightProtocolConfigured(): boolean {
  return Boolean(config.lightRpcUrl) && Boolean(config.compressedAttestationMint);
}

/**
 * Mint a compressed attestation token after a successful proof verification.
 * Called from the frontend after verify_payment_proof succeeds.
 */
export async function mintCompressedAttestation(
  lightRpcUrl: string,
  payerKeypair: Uint8Array,
  mintAddress: string,
  recipientAddress: string,
  amount: number = 1
): Promise<string> {
  // Dynamic import to avoid loading Light SDK when not configured
  const { createRpc } = await import('@lightprotocol/stateless.js');
  const { mintTo } = await import('@lightprotocol/compressed-token');
  const { Keypair, PublicKey } = await import('@solana/web3.js');

  const rpc = createRpc(lightRpcUrl, lightRpcUrl);
  const payer = Keypair.fromSecretKey(payerKeypair);
  const mint = new PublicKey(mintAddress);
  const recipient = new PublicKey(recipientAddress);

  const txSig = await mintTo(
    rpc,
    payer,
    mint,
    recipient,
    payer, // mint authority (Keypair implements Signer)
    amount
  );

  return txSig;
}
