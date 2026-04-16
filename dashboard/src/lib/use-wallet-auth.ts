'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useWallet } from '@solana/wallet-adapter-react';

interface UseWalletAuthResult {
  /** True while signMessage / signIn is in progress. */
  readonly running: boolean;
  /** Error from the most recent sign-in attempt, if any. */
  readonly error: string | null;
  /** Clears the stored error. */
  readonly clearError: () => void;
  /** Run the wallet sign-in flow now. Requires the wallet to be connected. */
  readonly trigger: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Arm the wallet sign-in flow so it auto-fires once the wallet finishes
   * connecting. Use this from a "Connect Wallet" button to chain the modal
   * with NextAuth sign-in. The flag is consumed on first successful trigger
   * (or any error / explicit cancel) and never re-fires on its own.
   */
  readonly armForConnect: () => void;
  /** Cancel a previously armed wallet auth intent without signing. */
  readonly cancel: () => void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function useWalletAuth(): UseWalletAuthResult {
  const { publicKey, signMessage, connected } = useWallet();
  const { status: sessionStatus } = useSession();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const [armed, setArmed] = useState(false);

  const trigger = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!publicKey || !signMessage) {
      return { ok: false, error: 'Wallet not connected' };
    }
    if (inFlightRef.current) {
      return { ok: false, error: 'Wallet sign-in already in progress' };
    }
    inFlightRef.current = true;
    setRunning(true);
    setError(null);
    try {
      const message = `Sign in to Aperture: ${Date.now()}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await signMessage(messageBytes);
      const signatureBase64 = bytesToBase64(signature);

      const result = await signIn('wallet', {
        wallet_address: publicKey.toBase58(),
        signature: signatureBase64,
        message,
        redirect: false,
      });

      if (!result?.ok) {
        const errorMessage = result?.error ?? 'Wallet authentication failed';
        setError(errorMessage);
        return { ok: false, error: errorMessage };
      }
      return { ok: true };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Wallet signature failed';
      setError(errorMessage);
      return { ok: false, error: errorMessage };
    } finally {
      inFlightRef.current = false;
      setRunning(false);
    }
  }, [publicKey, signMessage]);

  // When user explicitly armed the connect+auth flow, fire signIn once the
  // wallet finishes connecting. Disarms after the first attempt regardless of
  // outcome so it never silently re-runs.
  useEffect(() => {
    if (!armed) return;
    if (sessionStatus === 'authenticated') {
      setArmed(false);
      return;
    }
    if (!connected || !publicKey || !signMessage) return;
    if (inFlightRef.current) return;
    setArmed(false);
    void trigger();
  }, [armed, sessionStatus, connected, publicKey, signMessage, trigger]);

  return {
    running,
    error,
    clearError: () => setError(null),
    trigger,
    armForConnect: () => setArmed(true),
    cancel: () => setArmed(false),
  };
}
