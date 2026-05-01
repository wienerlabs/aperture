export const config = {
  policyServiceUrl: process.env.NEXT_PUBLIC_POLICY_SERVICE_URL ?? 'http://localhost:3001',
  complianceApiUrl: process.env.NEXT_PUBLIC_COMPLIANCE_API_URL ?? 'http://localhost:3002',
  proverServiceUrl: process.env.NEXT_PUBLIC_PROVER_SERVICE_URL ?? 'http://localhost:3003',
  lightRpcUrl: process.env.NEXT_PUBLIC_LIGHT_RPC_URL ?? '',
  compressedAttestationMint: process.env.NEXT_PUBLIC_COMPRESSED_ATTESTATION_MINT ?? '',
  agentServiceUrl: process.env.NEXT_PUBLIC_AGENT_SERVICE_URL ?? 'http://localhost:3004',
  solanaRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  solanaNetwork: process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet',
  tokens: {
    // aUSDC: Aperture's Token-2022 mint with the compliance transfer hook.
    // Mint address is unchanged from the original vUSDC deployment; only
    // the on-chain metadata was rebranded. NEXT_PUBLIC_VUSDC_MINT remains
    // accepted as a fallback so already-rolled-out .env files keep working.
    aUSDC:
      process.env.NEXT_PUBLIC_AUSDC_MINT ??
      process.env.NEXT_PUBLIC_VUSDC_MINT ??
      'E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar',
    // Devnet defaults for the well-known USDC and USDT mints. These have no
    // transfer hook so adding them to a policy lets the agent bypass on-chain
    // compliance enforcement; the Policies form labels them "(no hook)".
    usdc:
      process.env.NEXT_PUBLIC_USDC_MINT ??
      '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    // Devnet USDT — Aperture-issued Token-1 SPL mint (the previous default
    // EJwZgeZ… address was a placeholder that did not resolve on chain).
    // Production swaps this for the real Tether USDT mint via the
    // NEXT_PUBLIC_USDT_MINT env override.
    usdt:
      process.env.NEXT_PUBLIC_USDT_MINT ??
      '92rsgTRBkCt16wMXFGEujHpj4WLpixoWRkP6wrLVooSm',
  },
  /// Decimals shared by every Token-2022 mint Aperture issues. Pinned
  /// to 6 to mirror USDC/vUSDC; changing this without re-issuing the
  /// mint accounts would silently misprice every transfer.
  tokenDecimals: 6,
  programs: {
    policyRegistry: process.env.NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM ?? 'FXD7ycSguBQw7o3DXqq4VUBHtdx5ZQpu9P2zb4KG4ZEU',
    verifier: process.env.NEXT_PUBLIC_VERIFIER_PROGRAM ?? 'AzKirEv7h5PstLNYNqLj7fCXU9EFA6nSnuoed3QkmUfU',
    transferHook: process.env.NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM ?? '3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt',
    aipRegistry: process.env.NEXT_PUBLIC_AIP_REGISTRY_PROGRAM ?? 'CgchXu2dRV3r9E1YjRhp4kbeLLtv1Xz61yoerJzp1Vbc',
    aipEscrow: process.env.NEXT_PUBLIC_AIP_ESCROW_PROGRAM ?? '59kc3swV6j6NqvhJoKKXAw1uWqGisY2txtf3LLM9Myhz',
  },
  explorerUrl: (address: string) =>
    `https://explorer.solana.com/address/${address}?cluster=${process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet'}`,
  txExplorerUrl: (sig: string) =>
    `https://explorer.solana.com/tx/${sig}?cluster=${process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet'}`,
} as const;
