"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Market, UserBet, formatUsdc, getOptionOdds, getOptionPct } from "@/lib/contract";
import { BetModal } from "./BetModal";

interface Props {
  market:         Market;
  userBet?:       UserBet | null;
  onRefresh:      () => void;
  livePrices?:    Record<string, number>;
  onBetPlaced?:   () => void;
  sessionWallet?: ethers.NonceManager | null;
}

function getLiveFeedKey(question: string): string | null {
  if (/gas/i.test(question)) return "ETH_GAS";
  const m = question.match(/\b(ETH|SOL|BTC|AVAX)\/USD/i);
  if (m) return `${m[1].toUpperCase()}/USD`;
  return null;
}

function formatLivePrice(key: string, value: number): string {
  if (key === "ETH_GAS") return `${value.toFixed(2)} gwei`;
  if (key === "BTC/USD") return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  resolved:  { label: "✓ RESOLVED",       cls: "text-px-green  border-px-green  neon-green"  },
  cancelled: { label: "✗ CANCELLED",      cls: "text-px-red    border-px-red"                },
  expired:   { label: "⏳ AWAITING",       cls: "text-px-yellow border-px-yellow neon-yellow" },
  active:    { label: "● LIVE",            cls: "text-px-cyan   border-px-cyan   neon-cyan"   },
};

const OPTION_COLORS = [
  { bar: "bg-px-purple", border: "border-px-purple", glow: "shadow-glow-purple" },
  { bar: "bg-px-cyan",   border: "border-px-cyan",   glow: "shadow-glow-cyan"   },
  { bar: "bg-px-green",  border: "border-px-green",  glow: "shadow-glow-green"  },
];

export function MarketCard({ market, userBet, onRefresh, livePrices = {}, onBetPlaced, sessionWallet }: Props) {
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (market.resolved || market.cancelled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [market.resolved, market.cancelled]);

  const now      = Math.floor(Date.now() / 1000);
  const timeLeft = Math.max(0, market.expiry - now);
  const expired  = timeLeft === 0;

  function formatTimeLeft() {
    if (timeLeft <= 0)     return "EXPIRED";
    if (timeLeft < 60)     return `${timeLeft}s`;
    if (timeLeft < 3600)   return `${Math.floor(timeLeft / 60)}m ${timeLeft % 60}s`;
    if (timeLeft < 86400)  return `${Math.floor(timeLeft / 3600)}h`;
    return `${Math.floor(timeLeft / 86400)}d`;
  }

  const statusKey = market.resolved ? "resolved" : market.cancelled ? "cancelled" : expired ? "expired" : "active";
  const status    = STATUS_STYLES[statusKey];

  const canClaim  = market.resolved && userBet && userBet.optionIndex === market.winningOption && !userBet.claimed;
  const didLose   = market.resolved && userBet && userBet.optionIndex !== market.winningOption;
  const claimed   = market.resolved && userBet?.claimed;

  const borderClass = canClaim ? "pixel-border-green" : statusKey === "active" ? "pixel-border-purple" : "pixel-border";

  const feedKey   = getLiveFeedKey(market.question);
  const liveValue = feedKey ? livePrices[feedKey] : undefined;
  // Strip the stale "(Now: $X)" from the question string
  const cleanQuestion = market.question.replace(/\s*\(Now:.*?\)/i, "");

  return (
    <div className={`bg-px-card rounded-none flex flex-col gap-4 p-5 ${borderClass} hover:border-px-purple transition-colors`}>

      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h3 className="text-white font-sans font-semibold text-sm leading-relaxed">
            {cleanQuestion}
          </h3>
          {feedKey && (
            <p className="mt-1 font-sans text-xs font-medium">
              {liveValue !== undefined ? (
                <span className="text-px-cyan">
                  ⬡ Chainlink live: {formatLivePrice(feedKey, liveValue)}
                </span>
              ) : (
                <span className="text-px-dim">⬡ Fetching Chainlink…</span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`font-sans font-bold text-xs border px-2 py-0.5 uppercase tracking-wider ${status.cls}`}>
            {statusKey === "active" ? formatTimeLeft() : status.label}
          </span>
        </div>
      </div>

      {/* Pool */}
      <div className="flex items-center justify-between text-xs font-pixel">
        <span className="text-px-dim uppercase tracking-wider">Pool</span>
        <span className="text-px-yellow neon-yellow font-bold font-sans">{formatUsdc(market.totalPool)} USDC</span>
      </div>

      {/* Options — HP bar style */}
      <div className="flex flex-col gap-2">
        {market.options.map((opt, i) => {
          const pct      = getOptionPct(market, i);
          const odds     = getOptionOdds(market, i);
          const isWinner = market.resolved && market.winningOption === i;
          const isMyBet  = userBet?.optionIndex === i;
          const col      = OPTION_COLORS[i % OPTION_COLORS.length];

          return (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <span className={`font-sans text-sm flex items-center gap-1.5 ${isWinner ? "text-px-green neon-green" : "text-gray-300"}`}>
                  {isWinner && <span className="font-pixel text-xs">★</span>}
                  {opt}
                  {isMyBet && (
                    <span className="bg-px-purple/30 border border-px-purple text-px-purple px-1.5 py-0.5 font-sans text-xs ml-1">
                      {formatUsdc(userBet!.amount)} USDC
                    </span>
                  )}
                </span>
                <span className="font-sans text-xs text-px-dim">{pct}% · {odds}</span>
              </div>
              {/* HP bar */}
              <div className="hp-bar-track h-4 relative overflow-hidden">
                <div
                  className={`h-full transition-all duration-700 ${isWinner ? "bg-px-green" : col.bar}`}
                  style={{ width: `${pct}%` }}
                />
                {/* Pixel notches */}
                <div className="absolute inset-0 flex items-center pointer-events-none">
                  {Array.from({ length: 9 }).map((_, n) => (
                    <div key={n} className="flex-1 border-r border-black/40 h-full" />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI provenance */}
      {market.storageHash.includes("mock") ? (
        <span
          title={`0G Storage hash: ${market.storageHash}`}
          className="text-px-dim font-pixel text-xs uppercase tracking-wider cursor-default"
        >
          [AI Generated · 0G Storage Demo]
        </span>
      ) : (
        <a
          href={`https://storage-node.0g.ai/download/${market.storageHash.replace("0g://", "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-px-dim hover:text-px-purple font-pixel text-xs uppercase tracking-wider transition-colors"
        >
          [AI Provenance ↗]
        </a>
      )}

      {/* ── User journey status strip ──────────────────────────── */}

      {/* Step 1 — Live, no bet yet */}
      {!market.resolved && !market.cancelled && !expired && !userBet && (
        <button
          onClick={() => setBetModalOpen(true)}
          className="btn-pixel w-full bg-px-purple text-white font-pixel font-bold py-3 uppercase tracking-widest text-sm hover:bg-purple-700 transition-colors"
        >
          ▶ PLACE BET
        </button>
      )}

      {/* Step 2 — Bet placed, market still live */}
      {userBet && !expired && !market.resolved && !market.cancelled && (
        <div className="w-full py-3 px-4 border-2 border-px-purple bg-px-purple/10 flex items-center gap-3">
          <span className="text-px-purple text-lg">🎯</span>
          <div>
            <p className="font-pixel text-xs text-px-purple uppercase tracking-widest">
              Bet placed — market still running
            </p>
            <p className="font-sans text-xs text-px-dim mt-0.5">
              <span className="text-white font-semibold">{formatUsdc(userBet.amount)} USDC</span> on &quot;{market.options[userBet.optionIndex]}&quot; · waiting for expiry
            </p>
          </div>
        </div>
      )}

      {/* Step 3 — Expired, awaiting Chainlink resolution */}
      {userBet && expired && !market.resolved && !market.cancelled && (
        <div className="w-full py-3 px-4 border-2 border-px-yellow bg-px-yellow/5 flex items-center gap-3">
          <span className="text-lg">⏳</span>
          <div>
            <p className="font-pixel text-xs text-px-yellow neon-yellow uppercase tracking-widest">
              Awaiting Chainlink resolution
            </p>
            <p className="font-sans text-xs text-px-dim mt-0.5">
              <span className="text-white font-semibold">{formatUsdc(userBet.amount)} USDC</span> on &quot;{market.options[userBet.optionIndex]}&quot; · oracle reading price…
            </p>
          </div>
        </div>
      )}

      {/* Step 4a — Won, claim available */}
      {canClaim && (
        <div className="flex flex-col gap-2">
          <div className="w-full py-2.5 px-4 border-2 border-px-green bg-px-green/10 flex items-center gap-3">
            <span className="text-lg">🏆</span>
            <div>
              <p className="font-pixel text-xs text-px-green neon-green uppercase tracking-widest">You won!</p>
              <p className="font-sans text-xs text-px-dim mt-0.5">
                &quot;{market.options[userBet!.optionIndex]}&quot; was correct · claim your winnings below
              </p>
            </div>
          </div>
          <button
            onClick={() => setBetModalOpen(true)}
            className="btn-pixel w-full bg-px-green text-black font-pixel font-bold py-3 uppercase tracking-widest text-sm hover:brightness-110 transition-all animate-pulse"
          >
            💰 CLAIM WINNINGS
          </button>
        </div>
      )}

      {/* Step 4b — Lost */}
      {didLose && (
        <div className="w-full py-3 px-4 border-2 border-px-red/40 bg-px-red/5 flex items-center gap-3">
          <span className="text-lg">💀</span>
          <div>
            <p className="font-pixel text-xs text-px-red uppercase tracking-widest">Better luck next time</p>
            <p className="font-sans text-xs text-px-dim mt-0.5">
              You picked &quot;{market.options[userBet!.optionIndex]}&quot; · winner was &quot;{market.options[market.winningOption]}&quot;
            </p>
          </div>
        </div>
      )}

      {/* Step 5 — Claimed */}
      {claimed && (
        <div className="w-full py-3 px-4 border-2 border-px-green/40 bg-px-green/5 flex items-center gap-3">
          <span className="text-lg">✅</span>
          <div>
            <p className="font-pixel text-xs text-px-green neon-green uppercase tracking-widest">Winnings claimed</p>
            <p className="font-sans text-xs text-px-dim mt-0.5">USDC sent to your wallet</p>
          </div>
        </div>
      )}

      {betModalOpen && (
        <BetModal
          market={market}
          userBet={userBet}
          sessionWallet={sessionWallet}
          onClose={() => setBetModalOpen(false)}
          onSuccess={() => { setBetModalOpen(false); onRefresh(); onBetPlaced?.(); }}
        />
      )}
    </div>
  );
}
