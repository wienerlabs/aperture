'use client';

import { type ReactNode } from 'react';
import { AuthProvider } from './AuthProvider';
import { ThemeProvider } from './ThemeProvider';
import { SolanaProvider } from './WalletProvider';
import { ApertureWalletModalProvider } from '../shared/WalletModal';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SolanaProvider>
          <ApertureWalletModalProvider>{children}</ApertureWalletModalProvider>
        </SolanaProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
