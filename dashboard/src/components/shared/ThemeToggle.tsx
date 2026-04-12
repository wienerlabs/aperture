'use client';

import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className={`p-2 rounded-lg transition-colors duration-200 ${
        theme === 'dark'
          ? 'text-[#f8b300] hover:text-white hover:bg-[#f8b300]/20'
          : 'text-amber-600 hover:text-amber-700 hover:bg-amber-100'
      } ${className ?? ''}`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
