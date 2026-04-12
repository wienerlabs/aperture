import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mondwest: ['var(--font-mondwest)', 'sans-serif'],
        sans: ['var(--font-mondwest)', 'sans-serif'],
        mono: ['var(--font-mondwest)', 'sans-serif'],
      },
      colors: {
        aperture: {
          DEFAULT: '#f8b300',
          dark: '#c98f00',
        },
      },
    },
  },
  plugins: [],
};
export default config;
