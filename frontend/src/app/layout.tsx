import type { Metadata } from "next";
import { Pixelify_Sans } from "next/font/google";
import "./globals.css";
import { DynamicProvider } from "@/components/DynamicProvider";

const pixelify = Pixelify_Sans({
  subsets:  ["latin"],
  variable: "--font-pixelify",
  weight:   ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title:       "AlphaMarket — AI Prediction Markets",
  description: "AI creates markets. Humans bet. Chainlink resolves. Settled in USDC on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${pixelify.variable} font-pixel bg-px-bg min-h-screen scanlines grid-bg`}>
        <DynamicProvider>
          {children}
        </DynamicProvider>
      </body>
    </html>
  );
}
