import type { Config } from "tailwindcss";

// Palette lifted from ajna-frontend's landing page (--background: rgb(3,0,20), the violet
// accent family used on its sign-up pill) -- same dark, violet-glow visual language, now
// carrying a real dashboard instead of a hero animation.
export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        panel: "rgba(255, 255, 255, 0.04)",
        "panel-border": "rgba(255, 255, 255, 0.08)",
        accent: "#9465ff",
        "accent-soft": "rgba(113, 47, 255, 0.12)",
        "accent-border": "#7f60a3",
      },
      fontFamily: {
        aeonik: ["var(--font-aeonik)", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
