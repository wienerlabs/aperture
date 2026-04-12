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
    vUSDC: process.env.NEXT_PUBLIC_VUSDC_MINT ?? 'E9Ab23WT97qHTmmWxEmHfWCmPsrQb77nJnAFFuDRfhar',
  },
  programs: {
    policyRegistry: process.env.NEXT_PUBLIC_POLICY_REGISTRY_PROGRAM ?? 'CZxdDpayJuLT1GVQcmhRKahLM6gTdBFpkirHjrvSGKVs',
    verifier: process.env.NEXT_PUBLIC_VERIFIER_PROGRAM ?? 'HrYMqPEiMnYSskmi3iAp57X8Ke6BiP2WsjGvMPEqBtmr',
    transferHook: process.env.NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM ?? '3GZAsASQHTJTCfHGRKaj26zdAVqcD9VZdpfV9FEwcCQt',
  },
  explorerUrl: (address: string) =>
    `https://explorer.solana.com/address/${address}?cluster=${process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet'}`,
  txExplorerUrl: (sig: string) =>
    `https://explorer.solana.com/tx/${sig}?cluster=${process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet'}`,
} as const;
