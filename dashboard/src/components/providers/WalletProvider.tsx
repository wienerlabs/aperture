"use client";

import React, { FC, ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { config } from "@/lib/config";

export const SolanaProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const network = WalletAdapterNetwork.Devnet;
  // Prefer the runtime-configured RPC (e.g. Helius on devnet) over the
  // public clusterApiUrl, which has a 30-second confirm timeout that
  // routinely trips browser-side confirmTransaction calls. Falling back
  // to clusterApiUrl keeps the dev parity story intact when no RPC is
  // explicitly configured.
  const endpoint = useMemo(
    () => config.solanaRpcUrl || clusterApiUrl(network),
    [network],
  );
  // Register Phantom and Solflare so users without an installed Solana
  // wallet still see install links instead of an empty modal. Standard
  // wallets that announce themselves through the Wallet Standard API are
  // picked up automatically and merged in by wallet-adapter-react.
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
};
