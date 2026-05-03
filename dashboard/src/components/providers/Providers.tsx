'use client';

import { type ReactNode } from 'react';
import { AuthProvider } from './AuthProvider';
import { ThemeProvider } from './ThemeProvider';
import { SolanaProvider } from './WalletProvider';
import { ApertureWalletModalProvider } from '../shared/WalletModal';
import { TxModalProvider } from './TxModalProvider';

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SolanaProvider>
          <ApertureWalletModalProvider>
            <TxModalProvider>{children}</TxModalProvider>
          </ApertureWalletModalProvider>
        </SolanaProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
