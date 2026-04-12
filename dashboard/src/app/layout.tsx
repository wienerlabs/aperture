import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers/Providers";
import "./globals.css";

const mondwest = localFont({
  src: '../app/fonts/PPMondwest-Regular.otf',
  variable: '--font-mondwest',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Aperture - ZK Compliance for AI Agent Payments",
  description:
    "Privacy-preserving payment compliance for enterprise AI agents. ZK proofs, x402, MPP. Built on Solana.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={mondwest.variable}>
      <body className="antialiased font-mondwest">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
