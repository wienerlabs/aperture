import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // UI sans — Host Grotesk primary, Inter fallback
        sans: [
          "var(--font-host-grotesk)",
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        // Display face — KMR Waldenburg primary, serif fallbacks
        display: [
          "var(--font-waldenburg)",
          "var(--font-fraunces)",
          "var(--font-mondwest)",
          "ui-serif",
          "Georgia",
          "Times New Roman",
          "serif",
        ],
        waldenburg: ["var(--font-waldenburg)", "serif"],
        // Legacy aliases — kept so existing `font-mono` / `font-mondwest`
        // class usages do not break, but they now resolve to the new sans.
        mondwest: ["var(--font-host-grotesk)", "sans-serif"],
        mono: ["var(--font-host-grotesk)", "ui-monospace", "monospace"],
      },
      colors: {
        aperture: {
          DEFAULT: "#f8b300",
          dark: "#c98f00",
          light: "#ffd066",
        },
        // Antimetal-style semantic tokens (warm-tinted)
        ink: {
          DEFAULT: "#1a1a1a",
          slate: "#6b7184",
          ash: "#7c8293",
          storm: "#596075",
          fog: "#e5e3df",
        },
        canvas: {
          DEFAULT: "#ffffff",
          surface: "#ffffff",
          chip: "rgba(248, 179, 0, 0.04)",
        },
        hero: "#f8b300",
      },
      fontSize: {
        caption: ["13px", { lineHeight: "1", letterSpacing: "-0.21px" }],
        body: ["16px", { lineHeight: "1.5", letterSpacing: "-0.16px" }],
        subheading: ["18px", { lineHeight: "1.33", letterSpacing: "-0.09px" }],
        "heading-sm": ["22px", { lineHeight: "1.29", letterSpacing: "-0.22px" }],
        heading: ["28px", { lineHeight: "1.17", letterSpacing: "-0.14px" }],
        "heading-lg": ["40px", { lineHeight: "1.05", letterSpacing: "-0.4px" }],
        display: ["48px", { lineHeight: "1.04", letterSpacing: "-0.48px" }],
      },
      letterSpacing: {
        tightest: "-0.016em",
        tighter: "-0.015em",
        snug: "-0.010em",
        cozy: "-0.005em",
      },
      borderRadius: {
        card: "20px",
        "card-md": "16px",
        "card-sm": "6px",
        badge: "16px",
        input: "0px",
        pill: "9999px",
        "pill-lg": "60px",
      },
      spacing: {
        "px-card": "20px",
        "section-gap": "80px",
      },
      maxWidth: {
        page: "1200px",
      },
      boxShadow: {
        "ap-md":
          "rgba(101, 69, 0, 0.08) 0px 6px 16px -3px, rgba(101, 69, 0, 0.04) 0px 0px 0px 1px",
        "ap-card":
          "rgba(101, 69, 0, 0.03) 0px 56px 72px -16px, rgba(101, 69, 0, 0.03) 0px 32px 32px -16px, rgba(101, 69, 0, 0.04) 0px 6px 12px -3px, rgba(101, 69, 0, 0.04) 0px 0px 0px 1px",
        "ap-badge":
          "rgba(101, 69, 0, 0.08) 0px 6px 16px -3px, rgba(101, 69, 0, 0.04) 0px 0px 0px 1px",
        "ap-cta":
          "rgba(101, 69, 0, 0.32) 0px 1px 3px 0px, rgba(101, 69, 0, 0.12) 0px 0.5px 0.5px 0px, rgba(101, 69, 0, 0.44) 0px 12px 24px -12px, rgba(255, 255, 255, 0.18) 0px 8px 16px 0px inset, rgba(255, 255, 255, 0.48) 0px 0.5px 0.5px 0px inset",
        "ap-cta-light":
          "rgba(255, 255, 255, 0.72) 0px 1px 1px 0px inset, rgba(101, 69, 0, 0.06) 0px 8px 16px 0px, rgba(101, 69, 0, 0.08) 0px 4px 12px 0px, rgba(101, 69, 0, 0.10) 0px 1px 2px 0px, rgba(101, 69, 0, 0.12) 0px 0px 0px 1px",
        "ap-ghost-orange":
          "rgba(255, 255, 255, 0.10) 0px 0px 16px 8px inset, rgba(255, 255, 255, 0.10) 0px 0px 8px 4px inset, rgba(255, 255, 255, 0.10) 0px 0px 4px 2px inset, rgba(255, 255, 255, 0.16) 0px 0px 2px 1px inset",
        "ap-announce":
          "rgba(255, 255, 255, 0.88) 0px 1px 1px 0px inset, rgba(101, 69, 0, 0.04) 0px 48px 72px -12px, rgba(101, 69, 0, 0.03) 0px 28px 40px 0px, rgba(101, 69, 0, 0.02) 0px 4px 12px 0px, rgba(101, 69, 0, 0.06) 0px 0px 0px 1px",
      },
      transitionTimingFunction: {
        spring:
          "linear(0 0%, 0.026 1.8%, 0.108 3.9%, 0.59 12.2%, 0.792 16.5%, 0.931 21%, 0.978 23.4%, 1.01 25.9%, 1.033 29.3%, 1.04 33.3%, 1.001 56.9%, 1 100%)",
      },
    },
  },
  plugins: [],
};
export default config;
