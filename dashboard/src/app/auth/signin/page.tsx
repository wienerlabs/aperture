'use client';

import { useState, useCallback, useEffect, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useApertureWalletModal } from '@/components/shared/WalletModal';
import Link from 'next/link';
import { MatrixRain } from '@/components/shared/MatrixRain';
import { ApertureLogo } from '@/components/shared/ApertureLogo';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

interface FormErrors {
  email: string;
  password: string;
  general: string;
}

const EMPTY_ERRORS: FormErrors = { email: '', password: '', general: '' };

function validateForm(email: string, password: string): FormErrors {
  const errors = { ...EMPTY_ERRORS };
  if (!email.trim()) {
    errors.email = 'Email is required';
  } else if (!EMAIL_REGEX.test(email.trim())) {
    errors.email = 'Please enter a valid email address';
  }
  if (!password) {
    errors.password = 'Password is required';
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return errors.email !== '' || errors.password !== '' || errors.general !== '';
}

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(EMPTY_ERRORS);
  const [isCredentialLoading, setIsCredentialLoading] = useState(false);
  const [isWalletLoading, setIsWalletLoading] = useState(false);
  const { publicKey, signMessage, connected } = useWallet();
  const { setVisible: openWalletModal } = useApertureWalletModal();

  const handleWalletAuth = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    setIsWalletLoading(true);
    setErrors(EMPTY_ERRORS);
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
        setErrors({ ...EMPTY_ERRORS, general: result?.error ?? 'Wallet authentication failed' });
      }
    } catch {
      setErrors({ ...EMPTY_ERRORS, general: 'Wallet signature failed. Please try again.' });
    } finally {
      setIsWalletLoading(false);
    }
  }, [publicKey, signMessage]);

  useEffect(() => {
    if (connected && publicKey && signMessage) {
      handleWalletAuth();
    }
  }, [connected, publicKey, signMessage, handleWalletAuth]);

  async function handleCredentialsSubmit(e: FormEvent) {
    e.preventDefault();
    const validationErrors = validateForm(email, password);
    setErrors(validationErrors);
    if (hasErrors(validationErrors)) return;
    setIsCredentialLoading(true);
    try {
      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: true,
        callbackUrl: '/dashboard',
      });
      if (result?.error) {
        setErrors({ ...EMPTY_ERRORS, general: result.error });
      }
    } catch {
      setErrors({ ...EMPTY_ERRORS, general: 'An unexpected error occurred. Please try again.' });
    } finally {
      setIsCredentialLoading(false);
    }
  }

  const isAnyLoading = isCredentialLoading || isWalletLoading;

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
        <h1 className="mb-6 text-center font-mono text-2xl font-bold text-amber-400">Sign In</h1>

        {errors.general && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {errors.general}
          </div>
        )}

        <form onSubmit={handleCredentialsSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block font-mono text-sm text-amber-400/70">Email</label>
            <input id="email" type="email" value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((prev) => ({ ...prev, email: '', general: '' })); }}
              placeholder="you@example.com" disabled={isAnyLoading}
              className={`w-full rounded-lg border bg-transparent px-4 py-2.5 font-mono text-sm text-amber-100 placeholder:text-amber-400/30 outline-none transition-colors ${errors.email ? 'border-red-500/50 focus:border-red-500' : 'border-amber-400/20 focus:border-amber-400'} disabled:opacity-50`}
            />
            {errors.email && <p className="mt-1 text-xs text-red-400">{errors.email}</p>}
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block font-mono text-sm text-amber-400/70">Password</label>
            <input id="password" type="password" value={password}
              onChange={(e) => { setPassword(e.target.value); setErrors((prev) => ({ ...prev, password: '', general: '' })); }}
              placeholder="Enter your password" disabled={isAnyLoading}
              className={`w-full rounded-lg border bg-transparent px-4 py-2.5 font-mono text-sm text-amber-100 placeholder:text-amber-400/30 outline-none transition-colors ${errors.password ? 'border-red-500/50 focus:border-red-500' : 'border-amber-400/20 focus:border-amber-400'} disabled:opacity-50`}
            />
            {errors.password && <p className="mt-1 text-xs text-red-400">{errors.password}</p>}
          </div>
          <button type="submit" disabled={isAnyLoading}
            className="flex w-full items-center justify-center rounded-lg bg-amber-500 px-4 py-2.5 font-mono text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-50">
            {isCredentialLoading ? <LoadingSpinner /> : 'Sign In'}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-amber-400/20" />
          <span className="font-mono text-xs text-amber-400/40">or</span>
          <div className="h-px flex-1 bg-amber-400/20" />
        </div>

        <button type="button" onClick={() => openWalletModal(true)} disabled={isAnyLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 px-4 py-2.5 font-mono text-sm text-amber-400 transition-colors hover:bg-amber-400/10 disabled:opacity-50">
          <WalletIcon /> Connect Wallet
        </button>

        <p className="mt-6 text-center font-mono text-sm text-amber-400/50">
          Don&apos;t have an account?{' '}
          <Link href="/auth/signup" className="text-amber-400 underline underline-offset-4 transition-colors hover:text-amber-300">Sign Up</Link>
        </p>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg className="h-5 w-5 animate-spin text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 000 4h4v-4h-4z" />
    </svg>
  );
}
