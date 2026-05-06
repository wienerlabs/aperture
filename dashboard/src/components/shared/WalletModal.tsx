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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-sm rounded-[20px] p-6"
        style={{
          backgroundColor: '#ffffff',
          boxShadow:
            'rgba(101, 69, 0, 0.06) 0px 32px 56px -16px, rgba(101, 69, 0, 0.04) 0px 8px 16px -4px, rgba(101, 69, 0, 0.10) 0px 0px 0px 1px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-[20px] font-semibold text-black">Connect Wallet</h2>
          <button
            onClick={onClose}
            className="text-black/45 hover:text-black text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {error}
          </div>
        )}

        {connecting && (
          <div className="mb-4 rounded-lg border border-aperture/30 bg-aperture/8 px-3 py-2 text-[13px] text-aperture-dark animate-pulse">
            Approve the connection in your wallet...
          </div>
        )}

        {installedWallets.length > 0 && (
          <div className="space-y-2 mb-4">
            <p className="text-[12px] uppercase tracking-[0.08em] text-black/55 mb-2">
              Detected wallets
            </p>
            {installedWallets.map((w) => (
              <button
                key={w.adapter.name}
                onClick={() => handleSelect(w.adapter.name)}
                disabled={connecting}
                className="flex w-full items-center gap-3 rounded-[12px] border border-black/10 bg-white px-4 py-3 text-[15px] text-black transition-colors hover:border-aperture/40 hover:bg-aperture/5 disabled:opacity-50"
              >
                {w.adapter.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.adapter.icon} alt={w.adapter.name} className="h-6 w-6 rounded" />
                )}
                <span className="flex-1 text-left">{w.adapter.name}</span>
                {connecting && wallet?.adapter.name === w.adapter.name && (
                  <span className="text-[12px] text-aperture-dark animate-pulse">Connecting...</span>
                )}
              </button>
            ))}
          </div>
        )}

        {otherWallets.length > 0 && (
          <div className="space-y-2">
            <p className="text-[12px] uppercase tracking-[0.08em] text-black/55 mb-2">
              More wallets
            </p>
            {otherWallets.map((w) => (
              <a
                key={w.adapter.name}
                href={w.adapter.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center gap-3 rounded-[12px] border border-black/8 bg-white px-4 py-3 text-[15px] text-black/65 transition-colors hover:border-aperture/30 hover:bg-aperture/4"
              >
                {w.adapter.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.adapter.icon} alt={w.adapter.name} className="h-6 w-6 rounded" />
                )}
                <span className="flex-1 text-left">{w.adapter.name}</span>
                <span className="text-[12px] text-aperture-dark">Install</span>
              </a>
            ))}
          </div>
        )}

        {wallets.length === 0 && (
          <div className="flex flex-col gap-2 py-2">
            <p className="text-center text-[14px] text-black">
              No Solana wallets detected in this browser.
            </p>
            <p className="text-center text-[12px] text-black/55 mb-2">
              Install one of the wallets below, then return to connect.
            </p>
            <a
              href="https://phantom.app/download"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-3 rounded-[12px] border border-black/10 bg-white px-4 py-3 text-[15px] text-black transition-colors hover:border-aperture/40 hover:bg-aperture/5"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded bg-[#ab9ff2] text-xs font-bold text-black">P</span>
              <span className="flex-1 text-left">Phantom</span>
              <span className="text-[12px] text-aperture-dark">Install</span>
            </a>
            <a
              href="https://solflare.com/download"
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center gap-3 rounded-[12px] border border-black/10 bg-white px-4 py-3 text-[15px] text-black transition-colors hover:border-aperture/40 hover:bg-aperture/5"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded bg-[#fc8a3b] text-xs font-bold text-black">S</span>
              <span className="flex-1 text-left">Solflare</span>
              <span className="text-[12px] text-aperture-dark">Install</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
