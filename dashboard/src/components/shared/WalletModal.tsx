'use client';

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base';

interface WalletModalContextType {
  visible: boolean;
  setVisible: (open: boolean) => void;
}

const WalletModalContext = createContext<WalletModalContextType>({
  visible: false,
  setVisible: () => {},
});

export function useApertureWalletModal() {
  return useContext(WalletModalContext);
}

export function ApertureWalletModalProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      {visible && <ApertureWalletModal onClose={() => setVisible(false)} />}
    </WalletModalContext.Provider>
  );
}

function ApertureWalletModal({ onClose }: { onClose: () => void }) {
  const { wallets, select, connect, wallet, connected, publicKey, connecting } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);

  const installedWallets = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable
  );

  const otherWallets = wallets.filter(
    (w) => w.readyState === WalletReadyState.NotDetected
  );

  // After select() changes the wallet, call connect()
  useEffect(() => {
    if (!pendingWallet) return;
    if (!wallet) return;
    if (wallet.adapter.name !== pendingWallet) return;
    if (connecting || connected) return;

    setPendingWallet(null);

    // Small delay to let adapter fully initialize after select
    const timer = setTimeout(() => {
      connect().catch((err) => {
        setError(err instanceof Error ? err.message : 'Connection failed');
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [wallet, pendingWallet, connecting, connected, connect]);

  // Close modal on successful connection
  useEffect(() => {
    if (connected && publicKey) {
      onClose();
    }
  }, [connected, publicKey, onClose]);

  const handleSelect = useCallback((walletName: WalletName) => {
    setError(null);

    // Always call select first, then connect via the useEffect above
    setPendingWallet(walletName as string);
    select(walletName);

    // If wallet is already selected (same name), select() won't trigger a state change
    // so the useEffect won't fire. Handle this case by connecting directly after a delay.
    if (wallet?.adapter.name === walletName) {
      setTimeout(() => {
        connect().catch((err) => {
          setError(err instanceof Error ? err.message : 'Connection failed');
        });
      }, 200);
      setPendingWallet(null);
    }
  }, [select, wallet, connect]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-sm rounded-xl border border-amber-400/20 p-6"
        style={{ backgroundColor: 'rgba(10, 10, 10, 0.95)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-mono text-lg font-bold text-amber-400">Connect Wallet</h2>
          <button onClick={onClose} className="text-amber-400/50 hover:text-amber-400 text-xl">x</button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {connecting && (
          <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-400/70 font-mono animate-pulse">
            Approve the connection in your wallet...
          </div>
        )}

        {installedWallets.length > 0 && (
          <div className="space-y-2 mb-4">
            <p className="font-mono text-xs text-amber-400/50 mb-2">Detected wallets</p>
            {installedWallets.map((w) => (
              <button
                key={w.adapter.name}
                onClick={() => handleSelect(w.adapter.name)}
                disabled={connecting}
                className="flex w-full items-center gap-3 rounded-lg border border-amber-400/20 px-4 py-3 font-mono text-sm text-amber-400 transition-colors hover:bg-amber-400/10 disabled:opacity-50"
              >
                {w.adapter.icon && (
                  <img src={w.adapter.icon} alt={w.adapter.name} className="h-6 w-6 rounded" />
                )}
                <span className="flex-1 text-left">{w.adapter.name}</span>
                {connecting && wallet?.adapter.name === w.adapter.name && (
                  <span className="text-xs text-amber-400/50 animate-pulse">Connecting...</span>
                )}
              </button>
            ))}
          </div>
        )}

        {otherWallets.length > 0 && (
          <div className="space-y-2">
            <p className="font-mono text-xs text-amber-400/50 mb-2">More wallets</p>
            {otherWallets.map((w) => (
              <a
                key={w.adapter.name}
                href={w.adapter.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-3 rounded-lg border border-amber-400/10 px-4 py-3 font-mono text-sm text-amber-400/50 transition-colors hover:bg-amber-400/5"
              >
                {w.adapter.icon && (
                  <img src={w.adapter.icon} alt={w.adapter.name} className="h-6 w-6 rounded opacity-50" />
                )}
                <span className="flex-1 text-left">{w.adapter.name}</span>
                <span className="text-xs">Install</span>
              </a>
            ))}
          </div>
        )}

        {wallets.length === 0 && (
          <p className="text-center font-mono text-sm text-amber-400/50 py-4">
            No wallets found. Install Phantom or Solflare to connect.
          </p>
        )}
      </div>
    </div>
  );
}
