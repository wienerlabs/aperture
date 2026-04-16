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
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
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
