"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useDynamicContext, useIsLoggedIn, useUserWallets } from "@dynamic-labs/sdk-react-core";
import { Header } from "@/components/Header";
import { MarketCard } from "@/components/MarketCard";
import { PlayerProfile } from "@/components/PlayerProfile";
import { AiBotPanel } from "@/components/AiBotPanel";
import { Market, UserBet, getContract, ERC20_ABI, USDC_ADDRESS, formatUsdc } from "@/lib/contract";
import { ethers } from "ethers";

async function fetchMarketsFromAPI(): Promise<Market[]> {
  const res = await fetch("/api/markets");
  if (!res.ok) throw new Error(`markets API: ${res.status}`);
  const { markets } = await res.json();
  return (markets ?? []).map((m: any) => ({
    ...m,
    totalPool:   BigInt(m.totalPool),
    optionPools: (m.optionPools as string[]).map((v: string) => BigInt(v)),
  }));
}

type Filter = "all" | "live" | "awaiting" | "resolved" | "mybets";

const now = () => Math.floor(Date.now() / 1000);

function isLive     (m: Market) { return !m.resolved && !m.cancelled && now() < m.expiry; }
function isAwaiting (m: Market) { return !m.resolved && !m.cancelled && now() >= m.expiry; }
function isResolved (m: Market) { return m.resolved; }

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className={`bg-px-card border-2 ${color} p-4 flex flex-col gap-1 shadow-pixel`}>
      <div className={`font-sans font-bold text-2xl tracking-wider ${color.replace("border-", "text-")}`}>
        {value}
      </div>
      <div className="font-pixel text-xs text-px-dim uppercase tracking-widest">{label}</div>
    </div>
  );
}

export default function Home() {
  const { primaryWallet, authToken, setShowDynamicUserProfile } = useDynamicContext();
  const isLoggedIn  = useIsLoggedIn();
  const userWallets = useUserWallets();
  const userAddress = primaryWallet?.address;

  const [markets,     setMarkets]     = useState<Market[]>([]);
  const [userBets,    setUserBets]    = useState<Record<number, UserBet | null>>({});
  const [usdcBal,     setUsdcBal]     = useState<string>("—");
  const [initialLoad, setInitialLoad] = useState(true);
  const [generating,  setGenerating]  = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<{ userId: string; wallets: any[] } | null>(null);
  const [filter,      setFilter]      = useState<Filter>("live");
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [livePrices,     setLivePrices]     = useState<Record<string, number>>({});
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [sessionWallet,  setSessionWallet]  = useState<ethers.NonceManager | null>(null);

  const generatingRef   = useRef(false);
  const [genSeconds,    setGenSeconds]    = useState(0);
  const genTimerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const refresh = useCallback(() => setLastRefresh(Date.now()), []);

  // Silent background poll every 10s + trigger resolution of pending markets
  useEffect(() => {
    function tick() {
      fetch("/api/resolve-pending", { method: "POST" }).catch(() => {});
      refresh();
    }
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Live Chainlink prices — fetch once then every 30s
  useEffect(() => {
    function fetchPrices() {
      fetch("/api/prices")
        .then((r) => r.json())
        .then(setLivePrices)
        .catch(() => {});
    }
    fetchPrices();
    const id = setInterval(fetchPrices, 30_000);
    return () => clearInterval(id);
  }, []);

  // Fetch markets; keep old list visible while refreshing (no blank flash)
  useEffect(() => {
    fetchMarketsFromAPI()
      .then(async (loaded) => {
        setMarkets(loaded);        // swap in-place — old cards stay until new data lands
        setInitialLoad(false);

        // Always auto-generate when no live markets exist
        const hasLive = loaded.some(isLive);
        if (!hasLive && !generatingRef.current) {
          await triggerGenerate();
        }
      })
      .catch((e) => {
        console.error("fetchMarkets failed:", e);
        setInitialLoad(false);    // on error keep whatever is already displayed
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefresh]);

  // Verify Dynamic JWT on the server side when user logs in
  useEffect(() => {
    if (!isLoggedIn || !authToken) { setVerifiedUser(null); return; }
    fetch("/api/verify-user", { headers: { Authorization: `Bearer ${authToken}` } })
      .then((r) => r.json())
      .then((data) => { if (data.verified) setVerifiedUser(data); })
      .catch(() => {});
  }, [isLoggedIn, authToken]);

  // Load user bets — check both main wallet AND session wallet (bot bets)
  useEffect(() => {
    if (!userAddress || markets.length === 0) { setUserBets({}); setUsdcBal("—"); return; }
    const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
    const provider = new ethers.JsonRpcProvider(ARC_RPC);
    const contract = new ethers.Contract(
      process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!,
      ["function getUserBet(uint256 marketId, address user) view returns (uint256 amount, uint256 optionIndex, bool claimed)"],
      provider
    );
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

    usdc.balanceOf(userAddress)
      .then((bal: bigint) => setUsdcBal(formatUsdc(bal)))
      .catch(console.error);

    Promise.all(
      markets.map(async (m) => {
        try {
          // Check main wallet first
          const [amount, optionIndex, claimed] = await contract.getUserBet(m.id, userAddress);
          if (amount > 0n) return { id: m.id, bet: { amount, optionIndex: Number(optionIndex), claimed } };

          // Fall back to session wallet (bot bets)
          if (sessionAddress) {
            const [sAmount, sOptionIndex, sClaimed] = await contract.getUserBet(m.id, sessionAddress);
            if (sAmount > 0n) return { id: m.id, bet: { amount: sAmount, optionIndex: Number(sOptionIndex), claimed: sClaimed, betFromSession: true } };
          }

          return { id: m.id, bet: null };
        } catch {
          return { id: m.id, bet: null };
        }
      })
    ).then((results) => {
      const map: Record<number, UserBet | null> = {};
      results.forEach(({ id, bet }) => { map[id] = bet; });
      setUserBets(map);
    }).catch(console.error);
  }, [markets, userAddress, sessionAddress, lastRefresh]);

  // Generate new markets when switching to LIVE tab with no live markets
  async function triggerGenerate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setGenSeconds(0);
    genTimerRef.current = setInterval(() => setGenSeconds((s) => s + 1), 1000);
    try {
      await fetch("/api/create-markets", { method: "POST" });
      const fresh = await fetchMarketsFromAPI();
      setMarkets(fresh);
    } catch (e) {
      console.error("Generate failed", e);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
      if (genTimerRef.current) clearInterval(genTimerRef.current);
    }
  }

  async function handleLiveClick() {
    setFilter("live");
    if (!markets.some(isLive)) await triggerGenerate();
  }

  const liveCount     = markets.filter(isLive).length;
  const awaitingCount = markets.filter(isAwaiting).length;
  const resolvedCount = markets.filter(isResolved).length;
  const totalPool     = markets.reduce((sum, m) => sum + m.totalPool, 0n);

  const myBetMarkets  = markets.filter((m) => userBets[m.id]);
  const myBetCount    = myBetMarkets.length;
  const betsWon       = myBetMarkets.filter((m) => m.resolved && userBets[m.id]?.optionIndex === m.winningOption).length;
  const totalWagered  = myBetMarkets.reduce((sum, m) => sum + (userBets[m.id]?.amount ?? 0n), 0n);

  const filtered = markets.filter((m) => {
    if (filter === "live")     return isLive(m);
    if (filter === "awaiting") return isAwaiting(m);
    if (filter === "resolved") return isResolved(m);
    if (filter === "mybets")   return !!userBets[m.id];
    return true;
  });

  const claimable = markets.filter((m) =>
    isResolved(m) &&
    userBets[m.id] &&
    userBets[m.id]!.optionIndex === m.winningOption &&
    !userBets[m.id]!.claimed
  );

  const FILTERS: { key: Filter; label: string; count: number; color: string }[] = [
    { key: "live",     label: "LIVE",     count: liveCount,      color: "border-px-cyan   text-px-cyan"   },
    { key: "awaiting", label: "AWAITING", count: awaitingCount,  color: "border-px-yellow text-px-yellow" },
    { key: "resolved", label: "RESOLVED", count: resolvedCount,  color: "border-px-green  text-px-green"  },
    { key: "all",      label: "ALL",      count: markets.length, color: "border-px-border text-px-dim" },
    ...(userAddress ? [{ key: "mybets" as Filter, label: "MY BETS", count: myBetCount, color: "border-px-purple text-px-purple" }] : []),
  ];

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-6xl mx-auto px-4 py-8">

        {/* ── Hero ──────────────────────────────────────────────── */}
        <section className="text-center py-10 mb-8">
          <p className="font-pixel text-white text-xs tracking-widest uppercase mb-4">
            ▶ LIVE ON ARC TESTNET
          </p>
          <h2 className="font-pixel font-bold text-5xl md:text-7xl uppercase leading-tight mb-4">
            <span className="text-px-purple casino-purple">PREDICT</span>
            <span className="text-px-dim mx-3">·</span>
            <span className="text-px-cyan casino-cyan">STAKE</span>
            <span className="text-px-dim mx-3">·</span>
            <span className="text-px-green casino-green">WIN</span>
          </h2>
          <p className="font-pixel text-white/60 text-xs md:text-sm tracking-widest uppercase">
            AI picks the question&nbsp;&nbsp;·&nbsp;&nbsp;
            Chainlink picks the winner&nbsp;&nbsp;·&nbsp;&nbsp;
            USDC pays the spoils
          </p>
        </section>

        {/* ── Stats HUD ─────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatBox label="Live"       value={liveCount}                    color="border-px-cyan"   />
          <StatBox label="Awaiting"   value={awaitingCount}                color="border-px-yellow" />
          <StatBox label="Resolved"   value={resolvedCount}                color="border-px-green"  />
          <StatBox label="USDC Pooled" value={`$${formatUsdc(totalPool)}`} color="border-px-purple" />
        </div>

        {/* ── Dynamic Player Profile ────────────────────────────── */}
        {userAddress && (
          <PlayerProfile
            usdcBalance={usdcBal}
            betsPlaced={myBetCount}
            betsWon={betsWon}
            totalWagered={totalWagered}
            verifiedUser={verifiedUser}
            onOpenProfile={() => setShowDynamicUserProfile(true)}
          />
        )}

        {/* ── Claimable banner ──────────────────────────────────── */}
        {claimable.length > 0 && (
          <button
            onClick={() => setFilter("mybets")}
            className="w-full mb-6 pixel-border-green bg-px-green/10 flex items-center justify-between px-5 py-4 hover:bg-px-green/20 transition-colors"
          >
            <div className="flex items-center gap-4 font-pixel">
              <span className="text-2xl">💰</span>
              <div className="text-left">
                <p className="text-px-green neon-green font-bold text-sm uppercase tracking-widest">
                  {claimable.length} WINNING BET{claimable.length > 1 ? "S" : ""} READY TO CLAIM
                </p>
                <p className="text-px-dim text-xs mt-0.5 uppercase tracking-widest">Click MY BETS to claim →</p>
              </div>
            </div>
            <span className="text-px-green text-xl">▶</span>
          </button>
        )}

        {/* ── Filter tabs ───────────────────────────────────────── */}
        <div className="flex gap-2 mb-6 items-center flex-wrap">
          {FILTERS.map(({ key, label, count, color }) => {
            const active = filter === key;
            const activeColor = active ? color.replace("border-", "bg-").replace(" text-", " border-").split(" ")[0] : "";
            return (
              <button
                key={key}
                onClick={key === "live" ? handleLiveClick : () => setFilter(key)}
                className={`btn-pixel font-pixel text-xs px-4 py-2 uppercase tracking-widest border-2 transition-colors ${
                  active
                    ? `${color.split(" ")[0]} ${color.split(" ")[1]} bg-white/5`
                    : "border-px-border text-px-dim hover:border-px-purple hover:text-white"
                }`}
              >
                {label} <span className="opacity-60 font-sans">({count})</span>
              </button>
            );
          })}
          <button
            onClick={refresh}
            className="btn-pixel ml-auto border-2 border-px-border text-px-dim hover:border-px-purple hover:text-white font-pixel text-xs px-3 py-2 transition-colors"
          >
            ↻ SYNC
          </button>
        </div>

        {/* ── Generating banner (non-blocking — shows above existing markets) */}
        {generating && (
          <div className="text-center mb-4 font-pixel space-y-1 py-3 border border-px-yellow/30 bg-px-yellow/5">
            <p className="text-px-yellow neon-yellow text-sm uppercase tracking-widest animate-pulse">
              ⚡ AI is generating new markets...
            </p>
            <p className="text-px-dim text-xs uppercase tracking-widest">
              Signing transactions on Arc · {genSeconds}s elapsed
            </p>
          </div>
        )}

        {/* ── Markets grid ─────────────────────────────────────── */}
        {initialLoad ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-px-card pixel-border h-52 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 font-pixel">
            <div className="text-5xl mb-6">
              {filter === "live" ? "⚡" : filter === "awaiting" ? "⏳" : filter === "resolved" ? "✓" : filter === "mybets" ? "🎯" : "🔮"}
            </div>
            <p className={`text-lg uppercase tracking-widest mb-2 ${
              filter === "live"     ? "text-px-cyan   neon-cyan"   :
              filter === "awaiting" ? "text-px-yellow neon-yellow" :
              filter === "resolved" ? "text-px-green  neon-green"  :
              filter === "mybets"   ? "text-px-purple neon-purple" :
                                      "text-px-purple neon-purple"
            }`}>
              {filter === "mybets" ? "No bets placed yet" : `No ${filter} markets`}
            </p>
            {filter === "mybets" && (
              <p className="text-px-dim text-xs uppercase tracking-widest">
                Go to LIVE tab and place your first bet
              </p>
            )}
            {filter === "live" && (
              <p className="text-px-dim text-xs uppercase tracking-widest">
                Click LIVE tab to generate fresh markets
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                userBet={userBets[market.id]}
                onRefresh={refresh}
                livePrices={livePrices}
                onBetPlaced={() => { refresh(); }}
                sessionWallet={sessionWallet}
              />
            ))}
          </div>
        )}

        {/* ── How it works ─────────────────────────────────────── */}
        <section className="mt-20 pt-10 border-t-2 border-px-border">
          <h3 className="font-pixel font-bold text-center text-px-purple neon-purple text-xl uppercase tracking-widest mb-8">
            ── HOW IT WORKS ──
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { step: "01", title: "AI GENERATES",  desc: "0G Compute runs an LLM that reads Chainlink feeds and creates verifiable prediction markets",          color: "border-px-purple text-px-purple" },
              { step: "02", title: "STORED ON 0G",  desc: "Full AI reasoning is uploaded to 0G Storage. The on-chain hash proves which model created the market", color: "border-px-cyan   text-px-cyan"   },
              { step: "03", title: "HUMANS BET",    desc: "Connect via Dynamic wallet. Stake USDC on your prediction. Pooled liquidity sets real odds",          color: "border-px-green  text-px-green"  },
              { step: "04", title: "AUTO RESOLVES", desc: "At expiry the agent reads the live Chainlink feed on-chain and settles the contract — no admin",       color: "border-px-yellow text-px-yellow" },
            ].map(({ step, title, desc, color }) => (
              <div key={step} className={`bg-px-card border-2 p-4 shadow-pixel ${color}`}>
                <div className={`font-pixel font-black text-3xl mb-2 ${color.split(" ")[1]}`}>{step}</div>
                <div className={`font-pixel font-bold text-xs uppercase tracking-widest mb-2 ${color.split(" ")[1]}`}>{title}</div>
                <div className="font-pixel text-xs text-px-dim leading-relaxed">{desc}</div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* ── AI Bot Panel (floating) ───────────────────────────── */}
      <AiBotPanel
        markets={markets}
        livePrices={livePrices}
        userBets={userBets}
        onBetPlaced={() => { refresh(); }}
        onSessionWallet={(addr, wallet) => { setSessionAddress(addr); setSessionWallet(wallet ?? null); }}
      />
    </div>
  );
}
