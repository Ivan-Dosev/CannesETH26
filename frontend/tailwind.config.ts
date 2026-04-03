import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        pixel: ["var(--font-pixelify)", "monospace"],
      },
      colors: {
        px: {
          bg:      "#07070f",
          card:    "#0d0d1f",
          border:  "#2d1b69",
          purple:  "#9333ea",
          cyan:    "#22d3ee",
          green:   "#4ade80",
          yellow:  "#facc15",
          red:     "#f87171",
          dim:     "#3b3b5c",
        },
      },
      boxShadow: {
        pixel:        "4px 4px 0px #000",
        "pixel-sm":   "2px 2px 0px #000",
        "glow-purple":"0 0 12px #9333ea, 0 0 30px rgba(147,51,234,0.4)",
        "glow-cyan":  "0 0 12px #22d3ee, 0 0 30px rgba(34,211,238,0.4)",
        "glow-green": "0 0 12px #4ade80, 0 0 30px rgba(74,222,128,0.4)",
        "glow-yellow":"0 0 12px #facc15, 0 0 30px rgba(250,204,21,0.4)",
      },
      animation: {
        blink:    "blink 1s step-end infinite",
        flicker:  "flicker 3s linear infinite",
        scanline: "scanline 6s linear infinite",
      },
      keyframes: {
        blink: {
          "0%,100%": { opacity: "1" },
          "50%":     { opacity: "0" },
        },
        flicker: {
          "0%,19%,21%,23%,25%,54%,56%,100%": { opacity: "1" },
          "20%,24%,55%":                       { opacity: "0.6" },
        },
        scanline: {
          "0%":   { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
