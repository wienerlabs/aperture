'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronDown } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSession } from 'next-auth/react';
import { useApertureWalletModal } from '../shared/WalletModal';
import { ApertureLogo } from '../shared/ApertureLogo';
import { ThemeToggle } from '../shared/ThemeToggle';
import { useWalletAuth } from '@/lib/use-wallet-auth';

interface MoreMenuItem {
  readonly label: string;
  readonly href: string | null;
  readonly disabled?: boolean;
  readonly comingSoon?: boolean;
}

const navLinks = [
  { label: 'How it Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Pricing', href: '#pricing' },
];

function shortenAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const moreMenuItems: readonly MoreMenuItem[] = [
  { label: 'Docs', href: '/docs' },
  { label: 'Developers', href: '/developers' },
  { label: 'Integrate', href: '/integrate' },
  { label: 'API Documentation', href: '/api-docs' },
  { label: 'Changelog', href: '/changelog' },
  { label: 'Status', href: '/status' },
  { label: 'AIP Protocol', href: '/aip' },
];

function smoothScrollTo(href: string) {
  const id = href.replace('#', '');
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const { setVisible: openWalletModal } = useApertureWalletModal();
  const { connected, publicKey } = useWallet();
  const { data: session } = useSession();
  const { running: walletAuthRunning, trigger: triggerWalletAuth, armForConnect } = useWalletAuth();

  const isAuthenticated = Boolean(session);

  const handleConnectWallet = useCallback(() => {
    if (isAuthenticated) return;
    if (connected && publicKey) {
      // Wallet already connected — go straight to signMessage / signIn.
      void triggerWalletAuth();
      return;
    }
    // Wallet not connected — arm the flow and open the wallet modal. The hook
    // will fire signIn once the wallet finishes connecting.
    armForConnect();
    openWalletModal(true);
  }, [isAuthenticated, connected, publicKey, triggerWalletAuth, armForConnect, openWalletModal]);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 20);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [moreOpen]);

  return (
    <motion.nav
      initial={{ y: -80 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 bg-[#f8b300] ${
        scrolled ? 'shadow-md' : ''
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left - Logo */}
          <Link href="/" className="flex-shrink-0">
            <ApertureLogo variant="light" />
          </Link>

          {/* Center - Nav Links (desktop) */}
          <div className="hidden md:flex items-center gap-8">
            <Link
              href={isAuthenticated ? '/dashboard' : '/auth/signin'}
              className="text-sm text-black font-semibold hover:text-black/70 transition-colors duration-200"
            >
              Dashboard
            </Link>
            {navLinks.map((link) =>
              link.href.startsWith('/') ? (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-black font-semibold hover:text-black/70 transition-colors duration-200"
                >
                  {link.label}
                </Link>
              ) : (
                <button
                  key={link.href}
                  onClick={() => smoothScrollTo(link.href)}
                  className="text-sm text-black font-semibold hover:text-black/70 transition-colors duration-200"
                >
                  {link.label}
                </button>
              )
            )}

            {/* More dropdown */}
            <div
              ref={moreRef}
              className="relative"
              onMouseEnter={() => setMoreOpen(true)}
              onMouseLeave={() => setMoreOpen(false)}
            >
              <button
                type="button"
                onClick={() => setMoreOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className="inline-flex items-center gap-1 text-sm text-black font-semibold hover:text-black/70 transition-colors duration-200"
              >
                More
                <ChevronDown
                  size={16}
                  className={`transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`}
                />
              </button>
              <AnimatePresence>
                {moreOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    role="menu"
                    className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 rounded-lg bg-[#000000] border border-amber-400/20 shadow-xl py-2"
                  >
                    {moreMenuItems.map((item) => {
                      if (item.disabled || item.href === null) {
                        return (
                          <div
                            key={item.label}
                            aria-disabled="true"
                            className="flex items-center justify-between px-4 py-2 text-sm text-amber-400/40 cursor-not-allowed select-none"
                          >
                            <span>{item.label}</span>
                            {item.comingSoon && (
                              <span className="ml-2 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/10 border border-amber-400/20 text-amber-400/70">
                                Soon
                              </span>
                            )}
                          </div>
                        );
                      }
                      return (
                        <Link
                          key={item.href ?? item.label}
                          href={item.href!}
                          role="menuitem"
                          onClick={() => setMoreOpen(false)}
                          className="block px-4 py-2 text-sm text-amber-200 hover:bg-amber-400/10 hover:text-amber-400 transition-colors"
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Right - Auth (desktop) */}
          <div className="hidden md:flex items-center gap-4">
            <ThemeToggle className="!text-black hover:!text-black/70 hover:!bg-black/10" />
            <Link
              href="/auth/signin"
              className="text-sm px-4 py-2 bg-black text-[#f8b300] rounded-lg font-semibold hover:bg-black/80 transition-colors duration-200"
            >
              Sign In
            </Link>
            <button
              onClick={handleConnectWallet}
              disabled={walletAuthRunning}
              className="text-sm px-4 py-2 bg-black text-[#f8b300] rounded-lg font-semibold hover:bg-black/80 transition-colors duration-200 disabled:opacity-60"
            >
              {walletAuthRunning
                ? 'Signing…'
                : isAuthenticated && publicKey
                  ? shortenAddress(publicKey.toBase58())
                  : connected && publicKey
                    ? 'Sign Wallet'
                    : 'Connect Wallet'}
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-black p-2"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="md:hidden overflow-hidden bg-[#f8b300] border-t border-black/10"
          >
            <div className="px-4 py-6 flex flex-col gap-4">
              <Link
                href={isAuthenticated ? '/dashboard' : '/auth/signin'}
                onClick={() => setMobileOpen(false)}
                className="text-sm text-black font-semibold hover:text-black/70 transition-colors text-left py-2"
              >
                Dashboard
              </Link>
              {navLinks.map((link) =>
                link.href.startsWith('/') ? (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className="text-sm text-black font-semibold hover:text-black/70 transition-colors text-left py-2"
                  >
                    {link.label}
                  </Link>
                ) : (
                  <button
                    key={link.href}
                    onClick={() => { smoothScrollTo(link.href); setMobileOpen(false); }}
                    className="text-sm text-black font-semibold hover:text-black/70 transition-colors text-left py-2"
                  >
                    {link.label}
                  </button>
                )
              )}

              {/* Mobile More dropdown */}
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setMobileMoreOpen((prev) => !prev)}
                  aria-expanded={mobileMoreOpen}
                  className="flex items-center justify-between text-sm text-black font-semibold hover:text-black/70 transition-colors text-left py-2"
                >
                  <span>More</span>
                  <ChevronDown
                    size={16}
                    className={`transition-transform duration-200 ${mobileMoreOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence>
                  {mobileMoreOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden pl-4 border-l border-black/15 mt-1 flex flex-col gap-2"
                    >
                      {moreMenuItems.map((item) => {
                        if (item.disabled || item.href === null) {
                          return (
                            <div
                              key={item.label}
                              aria-disabled="true"
                              className="flex items-center justify-between py-2 text-sm text-black/40 cursor-not-allowed select-none"
                            >
                              <span>{item.label}</span>
                              {item.comingSoon && (
                                <span className="ml-2 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/10 border border-black/20 text-black/60">
                                  Soon
                                </span>
                              )}
                            </div>
                          );
                        }
                        return (
                          <Link
                            key={item.href ?? item.label}
                            href={item.href!}
                            onClick={() => { setMobileOpen(false); setMobileMoreOpen(false); }}
                            className="text-sm text-black font-semibold hover:text-black/70 transition-colors py-2"
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="border-t border-black/10 pt-4 flex flex-col gap-3">
                <Link
                  href="/auth/signin"
                  className="text-sm px-4 py-2 bg-black text-[#f8b300] rounded-lg font-semibold text-center hover:bg-black/80 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign In
                </Link>
                <button
                  onClick={() => { handleConnectWallet(); setMobileOpen(false); }}
                  disabled={walletAuthRunning}
                  className="text-sm px-4 py-2 bg-black text-[#f8b300] rounded-lg font-semibold text-center hover:bg-black/80 transition-colors disabled:opacity-60"
                >
                  {walletAuthRunning
                    ? 'Signing…'
                    : isAuthenticated && publicKey
                      ? shortenAddress(publicKey.toBase58())
                      : connected && publicKey
                        ? 'Sign Wallet'
                        : 'Connect Wallet'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
