"use client";

import { DynamicWidget } from "@dynamic-labs/sdk-react-core";

const SPONSORS = [
  { name: "0G",        color: "text-px-cyan   border-px-cyan" },
  { name: "Dynamic",   color: "text-px-purple border-px-purple" },
  { name: "Arc",       color: "text-px-green  border-px-green" },
  { name: "Chainlink", color: "text-px-yellow border-px-yellow" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 bg-px-bg/95 backdrop-blur border-b-2 border-px-border">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="text-3xl leading-none">🔮</div>
          <div>
            <h1 className="text-px-purple neon-purple font-pixel font-bold text-xl tracking-wide leading-none uppercase">
              AlphaMarket
            </h1>
            <p className="text-px-dim text-xs mt-0.5 tracking-widest uppercase">
              AI · Chainlink · Arc · 0G
            </p>
          </div>
        </div>

        {/* Sponsor pills */}
        <div className="hidden md:flex gap-2 items-center">
          {SPONSORS.map((s) => (
            <span
              key={s.name}
              className={`font-pixel text-xs border px-2 py-1 btn-pixel uppercase tracking-wider ${s.color}`}
            >
              {s.name}
            </span>
          ))}
        </div>

        {/* Wallet */}
        <div className="shrink-0 [&_button]:font-pixel [&_button]:uppercase [&_button]:tracking-wide">
          <DynamicWidget />
        </div>

      </div>
    </header>
  );
}
