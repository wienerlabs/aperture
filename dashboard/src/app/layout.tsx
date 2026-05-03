import type { Metadata } from "next";
import localFont from "next/font/local";
import { Inter, Fraunces } from "next/font/google";
import { Providers } from "@/components/providers/Providers";
import "./globals.css";

const mondwest = localFont({
  src: "../app/fonts/PPMondwest-Regular.otf",
  variable: "--font-mondwest",
  display: "swap",
});

// KMR Waldenburg — primary display face (ivar role)
const waldenburg = localFont({
  src: "../app/fonts/KMRWaldenburg-Regular.otf",
  variable: "--font-waldenburg",
  display: "swap",
  weight: "400",
});

// Primary UI face — Host Grotesk is loaded via @import in globals.css
// (Next.js 14's next/font/google list does not include it yet).
// Inter kept as a graceful fallback.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  axes: ["opsz"],
});

// Fraunces kept as a graceful fallback under Waldenburg
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["400", "500"],
  style: ["normal"],
});

export const metadata: Metadata = {
  title: "Aperture - ZK Compliance for AI Agent Payments",
  description:
    "Privacy-preserving payment compliance for enterprise AI agents. ZK proofs, x402, MPP. Built on Solana.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${waldenburg.variable} ${fraunces.variable} ${mondwest.variable}`}
    >
      <body className="antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
