export interface TokenConfig {
  readonly symbol: string;
  readonly mint_address: string;
  readonly decimals: number;
}

export interface SolanaConfig {
  readonly rpc_url: string;
  readonly websocket_url: string;
  readonly network: 'devnet' | 'testnet' | 'mainnet-beta';
  readonly tokens: readonly TokenConfig[];
}

export const DEVNET_TOKENS: readonly TokenConfig[] = [
  {
    symbol: 'USDC',
    mint_address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
  },
  {
    symbol: 'USDT',
    mint_address: 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUQS7QEkCybt4rCxsT',
    decimals: 6,
  },
] as const;
