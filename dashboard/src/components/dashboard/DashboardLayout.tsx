'use client';

import { useState, type ReactNode } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Shield,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  LayoutDashboard,
  Bot,
} from 'lucide-react';
import { ApertureLogo } from '../shared/ApertureLogo';
import { ThemeToggle } from '../shared/ThemeToggle';


type TabId = 'overview' | 'policies' | 'payments' | 'compliance' | 'agent' | 'settings';

interface NavItem {
  readonly id: TabId;
  readonly label: string;
  readonly icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'policies', label: 'Policies', icon: Shield },
  { id: 'payments', label: 'Payments', icon: FileText },
  { id: 'compliance', label: 'Compliance', icon: BarChart3 },
  { id: 'agent', label: 'Agent Activity', icon: Bot },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

interface DashboardLayoutProps {
  readonly children: (activeTab: TabId, navigate: (tab: TabId) => void) => ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: session } = useSession();
  const { publicKey } = useWallet();

  const sessionWallet = (session?.user as { walletAddress?: string } | undefined)?.walletAddress;
  const walletAddress = publicKey?.toBase58() ?? sessionWallet ?? null;

  function handleSignOut(): void {
    signOut({ callbackUrl: '/auth/signin' });
  }

  return (
    <div className="flex h-screen bg-[#090600] text-amber-100">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSidebarOpen(false);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-[rgba(10,8,0,0.9)] border-r border-amber-400/10
          transform transition-transform duration-200 ease-in-out
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center justify-between p-6 border-b border-amber-400/10">
          <ApertureLogo compact />
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-amber-400/60 hover:text-amber-400"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={`
                  w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium
                  transition-all duration-150
                  ${
                    isActive
                      ? 'bg-amber-400/10 text-amber-400 border border-amber-400/20'
                      : 'text-amber-100/60 hover:text-amber-100 hover:bg-amber-400/5 border border-transparent'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top navbar */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-amber-400/10 bg-[rgba(10,8,0,0.9)]">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-amber-400/60 hover:text-amber-400"
              aria-label="Open sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden lg:flex items-center gap-2">
              <ApertureLogo compact />
              <span className="text-amber-100/40 mx-2">/</span>
              <span className="text-amber-100/80 text-sm font-medium">Dashboard</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <ThemeToggle />
            {walletAddress ? (
              <span className="hidden sm:inline-block px-3 py-1 rounded-lg bg-amber-400/10 text-amber-400 text-xs font-mono">
                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </span>
            ) : session?.user?.email && !session.user.email.endsWith('@wallet.aperture') ? (
              <span className="hidden sm:inline-block text-amber-100/60 text-xs">
                {session.user.email}
              </span>
            ) : null}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                text-amber-100/60 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </header>

        {/* Tab content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children(activeTab, setActiveTab)}
        </main>
      </div>
    </div>
  );
}

export type { TabId };
