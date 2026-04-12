'use client';

import { useSession } from 'next-auth/react';
import { useWallet } from '@solana/wallet-adapter-react';

export function useOperatorId(): string | null {
  const { data: session } = useSession();
  const { publicKey } = useWallet();

  // Priority 1: Connected wallet public key
  if (publicKey) return publicKey.toBase58();

  // Priority 2: Wallet address stored in session (from wallet auth)
  const walletAddress = (session?.user as { walletAddress?: string } | undefined)?.walletAddress;
  if (walletAddress) return walletAddress;

  // Priority 3: User ID from session (email/google auth)
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (userId) return userId;

  return null;
}
