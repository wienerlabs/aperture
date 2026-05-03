'use client';

import { useState, useCallback, type FormEvent } from 'react';
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
  confirmPassword: string;
  general: string;
}

const EMPTY_ERRORS: FormErrors = {
  email: '',
  password: '',
  confirmPassword: '',
  general: '',
};

function validateForm(
  email: string,
  password: string,
  confirmPassword: string
): FormErrors {
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

  if (!confirmPassword) {
    errors.confirmPassword = 'Please confirm your password';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return (
    errors.email !== '' ||
    errors.password !== '' ||
    errors.confirmPassword !== '' ||
    errors.general !== ''
  );
}

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>(EMPTY_ERRORS);
  const [isSignUpLoading, setIsSignUpLoading] = useState(false);
  const [isWalletLoading, setIsWalletLoading] = useState(false);
  const { publicKey, signMessage } = useWallet();
  const { setVisible: setWalletModalVisible } = useApertureWalletModal();

  const handleWalletAuth = useCallback(async () => {
    if (!publicKey || !signMessage) return;
    setIsWalletLoading(true);
    setErrors(EMPTY_ERRORS);
    try {
      const message = `Sign up to Aperture: ${Date.now()}`;
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

  async function handleSignUpSubmit(e: FormEvent) {
    e.preventDefault();

    const validationErrors = validateForm(email, password, confirmPassword);
    setErrors(validationErrors);

    if (hasErrors(validationErrors)) {
      return;
    }

    setIsSignUpLoading(true);

    try {
      const svcUrl = process.env.NEXT_PUBLIC_POLICY_SERVICE_URL ?? 'http://localhost:3001';
      const regRes = await fetch(`${svcUrl}/api/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, name: email.trim().split('@')[0] }),
      });
      const regBody = await regRes.json();
      if (!regRes.ok || !regBody.success) {
        setErrors({ ...EMPTY_ERRORS, general: regBody.error ?? 'Registration failed' });
        setIsSignUpLoading(false);
        return;
      }

      const result = await signIn('credentials', {
        email: email.trim().toLowerCase(),
        password,
        redirect: true,
        callbackUrl: '/dashboard',
      });

      if (result?.error) {
        setErrors({
          ...EMPTY_ERRORS,
          general: result.error,
        });
      }
    } catch {
      setErrors({
        ...EMPTY_ERRORS,
        general: 'An unexpected error occurred. Please try again.',
      });
    } finally {
      setIsSignUpLoading(false);
    }
  }

  function handleWalletConnect() {
    if (publicKey && signMessage) {
      handleWalletAuth();
    } else {
      setWalletModalVisible(true);
    }
  }

  const isAnyLoading = isSignUpLoading || isWalletLoading;

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

        <h1 className="mb-6 text-center font-mono text-2xl font-bold text-amber-400">
          Create Account
        </h1>

        {/* General error */}
        {errors.general && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {errors.general}
          </div>
        )}

        {/* Sign up form */}
        <form onSubmit={handleSignUpSubmit} className="space-y-4" noValidate>
          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1 block font-mono text-sm text-amber-400/70">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors((prev) => ({ ...prev, email: '', general: '' }));
              }}
              placeholder="you@example.com"
              disabled={isAnyLoading}
              className={`w-full rounded-lg border bg-transparent px-4 py-2.5 font-mono text-sm text-amber-100 placeholder:text-amber-400/30 outline-none transition-colors ${
                errors.email
                  ? 'border-red-500/50 focus:border-red-500'
                  : 'border-amber-400/20 focus:border-amber-400'
              } disabled:opacity-50`}
            />
            {errors.email && (
              <p className="mt-1 text-xs text-red-400">{errors.email}</p>
            )}
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="mb-1 block font-mono text-sm text-amber-400/70">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({ ...prev, password: '', general: '' }));
              }}
              placeholder="Min. 8 characters"
              disabled={isAnyLoading}
              className={`w-full rounded-lg border bg-transparent px-4 py-2.5 font-mono text-sm text-amber-100 placeholder:text-amber-400/30 outline-none transition-colors ${
                errors.password
                  ? 'border-red-500/50 focus:border-red-500'
                  : 'border-amber-400/20 focus:border-amber-400'
              } disabled:opacity-50`}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-red-400">{errors.password}</p>
            )}
          </div>

          {/* Confirm Password */}
          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-1 block font-mono text-sm text-amber-400/70"
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrors((prev) => ({ ...prev, confirmPassword: '', general: '' }));
              }}
              placeholder="Repeat your password"
              disabled={isAnyLoading}
              className={`w-full rounded-lg border bg-transparent px-4 py-2.5 font-mono text-sm text-amber-100 placeholder:text-amber-400/30 outline-none transition-colors ${
                errors.confirmPassword
                  ? 'border-red-500/50 focus:border-red-500'
                  : 'border-amber-400/20 focus:border-amber-400'
              } disabled:opacity-50`}
            />
            {errors.confirmPassword && (
              <p className="mt-1 text-xs text-red-400">{errors.confirmPassword}</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isAnyLoading}
            className="flex w-full items-center justify-center rounded-lg bg-amber-500 px-4 py-2.5 font-mono text-sm font-bold text-black transition-colors hover:bg-amber-400 disabled:opacity-50 disabled:hover:bg-amber-500"
          >
            {isSignUpLoading ? (
              <LoadingSpinner />
            ) : (
              'Sign Up'
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-amber-400/20" />
          <span className="font-mono text-xs text-amber-400/40">or</span>
          <div className="h-px flex-1 bg-amber-400/20" />
        </div>

        {/* Wallet connect */}
        <button
          type="button"
          onClick={handleWalletConnect}
          disabled={isAnyLoading}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400/40 px-4 py-2.5 font-mono text-sm text-amber-400 transition-colors hover:bg-amber-400/10 disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <WalletIcon />
          Connect Wallet
        </button>

        {/* Sign in link */}
        <p className="mt-6 text-center font-mono text-sm text-amber-400/50">
          Already have an account?{' '}
          <Link
            href="/auth/signin"
            className="text-amber-400 underline underline-offset-4 transition-colors hover:text-amber-300"
          >
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 000 4h4v-4h-4z" />
    </svg>
  );
}
