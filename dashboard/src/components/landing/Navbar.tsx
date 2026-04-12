'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useApertureWalletModal } from '../shared/WalletModal';
import { ApertureLogo } from '../shared/ApertureLogo';
import { ThemeToggle } from '../shared/ThemeToggle';

const navLinks = [
  { label: 'How it Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'Docs', href: '/docs' },
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
  const { setVisible: openWalletModal } = useApertureWalletModal();
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
              onClick={() => openWalletModal(true)}
              className="text-sm px-4 py-2 bg-black text-[#f8b300] rounded-lg font-semibold hover:bg-black/80 transition-colors duration-200"
            >
              Connect Wallet
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
              <div className="border-t border-black/10 pt-4 flex flex-col gap-3">
                <Link
                  href="/auth/signin"
                  className="text-sm px-4 py-2 bg-black text-[#f8b300] rounded-lg font-semibold text-center hover:bg-black/80 transition-colors"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign In
                </Link>
                <button
                  onClick={() => { openWalletModal(true); setMobileOpen(false); }}
                  className="text-sm px-4 py-2 bg-black text-[#f8b300] rounded-lg font-semibold text-center hover:bg-black/80 transition-colors"
                >
                  Connect Wallet
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
