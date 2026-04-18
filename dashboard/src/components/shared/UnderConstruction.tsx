'use client';

import Link from 'next/link';
import { Construction } from 'lucide-react';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';

interface UnderConstructionProps {
  title: string;
  description: string;
}

export function UnderConstruction({ title, description }: UnderConstructionProps) {
  return (
    <main className="relative min-h-screen bg-[#000000] flex flex-col">
      <Navbar />
      <section className="relative z-10 flex-1 flex items-center justify-center px-4 py-32">
        <div className="max-w-xl w-full text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-400/10 border border-amber-400/20 mb-6">
            <Construction className="w-6 h-6 text-amber-400" />
          </div>
          <h1 className="font-mono text-3xl sm:text-4xl font-bold text-amber-400 mb-4">{title}</h1>
          <p className="text-amber-400/75 text-sm sm:text-base leading-relaxed mb-10">{description}</p>
          <Link
            href="/"
            className="inline-block font-mono text-sm px-5 py-2.5 border border-amber-400/30 text-amber-400 rounded-lg hover:bg-amber-400/10 transition-colors"
          >
            Back to home
          </Link>
        </div>
      </section>
      <Footer />
    </main>
  );
}
