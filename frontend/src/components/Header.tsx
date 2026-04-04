"use client";

import { WalletModal } from "./WalletModal";
import { useDynamicWallet } from "@/hooks/useDynamicWallet";

const SPONSORS = [
  { name: "0G",        color: "text-px-cyan   border-px-cyan" },
  { name: "Dynamic",   color: "text-px-purple border-px-purple" },
  { name: "Arc",       color: "text-px-green  border-px-green" },
  { name: "Chainlink", color: "text-px-yellow border-px-yellow" },
];

function truncate(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function Header() {
  const { address, isLoggedIn, logout, openModal, closeModal, modalOpen } = useDynamicWallet();

  return (
    <>
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

          {/* Right side: wallet connect / disconnect */}
          <div className="flex items-center gap-2 shrink-0">
            {isLoggedIn && address ? (
              <>
                <span className="hidden sm:block border border-px-purple/50 bg-px-purple/10 px-2.5 py-1.5 font-pixel text-xs text-px-purple uppercase tracking-wide">
                  {truncate(address)}
                </span>
                <button
                  onClick={logout}
                  className="border border-px-border hover:border-px-red/60 bg-px-bg hover:bg-px-red/10 px-2.5 py-1.5 font-pixel text-xs text-px-dim hover:text-px-red uppercase tracking-wide transition-colors"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={openModal}
                className="border border-px-purple hover:bg-px-purple/20 bg-px-purple/10 px-3 py-1.5 font-pixel text-xs text-px-purple uppercase tracking-widest transition-colors neon-purple"
              >
                Connect Wallet
              </button>
            )}
          </div>

        </div>
      </header>

      {modalOpen && (
        <WalletModal
          onClose={closeModal}
          onConnected={closeModal}
        />
      )}
    </>
  );
}
