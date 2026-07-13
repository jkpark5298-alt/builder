import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f4f6f8",
          100: "#e8ecf0",
          200: "#d0d9e2",
          300: "#a8b8c8",
          400: "#7890a8",
          500: "#567088",
          600: "#425870",
          700: "#354858",
          800: "#2a3848",
          900: "#1a2430",
          950: "#0e141c",
        },
        accent: {
          DEFAULT: "#c45c26",
          soft: "#e8a070",
          muted: "#f5e6dc",
        },
        verify: {
          true: "#1a7a4c",
          false: "#b83a2e",
          mixed: "#b8860b",
          unverified: "#567088",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "mesh":
          "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(196,92,38,0.12), transparent), radial-gradient(ellipse 60% 40% at 90% 10%, rgba(26,36,48,0.08), transparent), linear-gradient(180deg, #f4f6f8 0%, #e8ecf0 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
