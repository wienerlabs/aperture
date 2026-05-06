'use client';

import { useState, useCallback, useEffect } from 'react';
import { signIn } from 'next-auth/react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useApertureWalletModal } from '@/components/shared/WalletModal';
import Link from 'next/link';
import { MatrixRain } from '@/components/shared/MatrixRain';
import { ApertureLogo } from '@/components/shared/ApertureLogo';

export default function SignInPage() {
  const [error, setError] = useState<string | null>(null);
  const [isWalletLoading, setIsWalletLoading] = useState(false);
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible: openWalletModal } = useApertureWalletModal();

  const handleWalletAuth = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    setIsWalletLoading(true);
    setError(null);
    try {
      const message = `Sign in to Aperture: ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase64 = btoa(String.fromCharCode.apply(null, Array.from(signature)));

      const result = await signIn('wallet', {
        wallet_address: publicKey.toBase58(),
        signature: signatureBase64,
        message,
        redirect: false,
      });

      if (result?.ok) {
        window.location.href = '/dashboard';
      } else {
        setError(result?.error ?? 'Wallet authentication failed');
      }
    } catch {
      setError('Wallet signature failed. Please try again.');
    } finally {
      setIsWalletLoading(false);
    }
  }, [publicKey, signMessage]);

  useEffect(() => {
    if (connected && publicKey && signMessage) {
      handleWalletAuth();
    }
  }, [connected, publicKey, signMessage, handleWalletAuth]);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 bg-[#000000]">
      <MatrixRain />
      <div
        className="relative z-10 w-full max-w-md rounded-xl border border-amber-400/20 p-8 bg-[rgba(10,10,10,0.8)] backdrop-blur-xl"
      >
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 font-mono text-sm text-amber-400/50 hover:text-amber-400 transition-colors"
        >
          &larr; Back
        </Link>
        <div className="mb-8 flex justify-center">
          <ApertureLogo />
        </div>
        <h1 className="mb-3 text-center font-mono text-2xl font-bold text-amber-400">Connect Wallet</h1>
        <p className="mb-6 text-center font-mono text-sm text-amber-100/60">
          Aperture is wallet-only. Sign a message with Phantom or Solflare to continue.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={() => openWalletModal(true)}
          disabled={isWalletLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-3 font-mono text-base font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
        >
          <WalletIcon /> {isWalletLoading ? 'Signing...' : 'Connect Wallet'}
        </button>

        <p className="mt-6 text-center font-mono text-xs text-amber-400/50">
          By connecting, you agree to sign a message proving wallet ownership.
        </p>
      </div>
    </div>
  );
}

function WalletIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 000 4h4v-4h-4z" />
    </svg>
  );
}
