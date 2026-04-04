"use client";

import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { Market, CONTRACT_ADDRESS, USDC_ADDRESS, CONTRACT_ABI, ERC20_ABI, ARC_CHAIN_ID } from "@/lib/contract";
import type { BotStrategy } from "@/app/api/parse-strategy/route";

const ARC_RPC       = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_HEX = "0x" + ARC_CHAIN_ID.toString(16);

interface Props {
  markets:    Market[];
  livePrices: Record<string, number>;
  userBets:   Record<number, any>;
  onBetPlaced: () => void;
}

interface LogEntry {
  ts:      string;
  type:    "user" | "ai" | "info" | "success" | "error";
  message: string;
}

// Same parsing logic as resolve-pending — extract feed, threshold, direction from question text
function parseMarketQuestion(question: string): { feedKey: string; threshold: number; optionIfAbove: number } | null {
  const q = question.replace(/\s*\(Now:.*?\)/i, "");
  const isBearish = /drop below|fall below|sink below|stay below|drops below|falls below/i.test(q);

  const gasAbove = q.match(/gas.*?(?:spike above|exceed)\s+([0-9.]+)\s+gwei/i);
  if (gasAbove) return { feedKey: "ETH_GAS", threshold: parseFloat(gasAbove[1]), optionIfAbove: 0 };

  const gasBelow = q.match(/gas.*?stay below\s+([0-9.]+)\s+gwei/i);
  if (gasBelow) return { feedKey: "ETH_GAS", threshold: parseFloat(gasBelow[1]), optionIfAbove: 1 };

  const m = q.match(/Will\s+(ETH|SOL|BTC|AVAX)\/USD.*?\$([0-9,]+(?:\.[0-9]+)?)/i);
  if (m) {
    return {
      feedKey:       `${m[1].toUpperCase()}/USD`,
      threshold:     parseFloat(m[2].replace(/,/g, "")),
      optionIfAbove: isBearish ? 1 : 0,
    };
  }
  return null;
}

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Minimum trigger time — Arc tx takes ~3-5s to mine, so firing under 20s risks "Betting closed"
const MIN_TRIGGER_SECS = 20;

const SUGGESTIONS = [
  "Bet $0.1 on ETH price markets when 20s left, bet on whichever side Chainlink favors",
  "Auto-bet $0.5 on BTC and SOL markets under 30 seconds, max 5 bets",
  "Watch all price markets, bet $0.2 on the likely winner when 25 seconds remain",
];

export function AiBotPanel({ markets, livePrices, userBets, onBetPlaced }: Props) {
  const { primaryWallet } = useDynamicContext();

  const [open,      setOpen]      = useState(false);
  const [input,     setInput]     = useState("");
  const [logs,      setLogs]      = useState<LogEntry[]>([{
    ts: timestamp(), type: "ai",
    message: "👋 Describe a trading strategy in plain English and I'll execute it automatically with your connected wallet. Your bot will watch live markets and place bets on your behalf.",
  }]);
  const [strategy,  setStrategy]  = useState<BotStrategy | null>(null);
  const [botActive, setBotActive] = useState(false);
  const [parsing,   setParsing]   = useState(false);
  const [betsCount, setBetsCount] = useState(0);

  const bettedRef  = useRef<Set<number>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  function addLog(type: LogEntry["type"], message: string) {
    setLogs(prev => [...prev.slice(-99), { ts: timestamp(), type, message }]);
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Parse strategy from user instruction ────────────────────
  async function handleSend() {
    const text = input.trim();
    if (!text || parsing) return;
    setInput("");
    addLog("user", text);
    setParsing(true);
    addLog("ai", "🧠 Parsing strategy with 0G AI...");

    try {
      const res  = await fetch("/api/parse-strategy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text }),
      });
      const data = await res.json();

      if (data.strategy) {
        // Enforce minimum trigger — Arc txs take 3-5s to mine
        const safeTrigger = Math.max(data.strategy.triggerSecondsLeft, MIN_TRIGGER_SECS);
        const strategy: BotStrategy = { ...data.strategy, triggerSecondsLeft: safeTrigger };
        setStrategy(strategy);
        setBetsCount(0);
        bettedRef.current.clear();
        setBotActive(false);
        const src = data.source === "0g-ai" ? "0G Compute (LLaMA-70B)" : "keyword parser";
        addLog("ai", `✅ Strategy parsed via ${src}:`);
        addLog("ai", `📋 ${strategy.description}`);
        if (safeTrigger > data.strategy.triggerSecondsLeft) {
          addLog("info", `⚠️ Trigger raised to ${safeTrigger}s (Arc needs ~5s to mine — firing earlier prevents "Betting closed")`);
        }
        addLog("ai", `⚙️  Assets: ${strategy.assets.join(", ")} · Trigger: ≤${strategy.triggerSecondsLeft}s · $${strategy.betAmount}/bet · max ${strategy.maxBetsTotal} bets`);
        addLog("ai", `▶ Press START BOT to activate. Your wallet will prompt for each transaction.`);
      } else {
        addLog("error", `Could not parse strategy: ${data.error ?? "unknown"}`);
      }
    } catch (e: any) {
      addLog("error", `Error: ${e.message}`);
    } finally {
      setParsing(false);
    }
  }

  // ── Bot execution loop ───────────────────────────────────────
  useEffect(() => {
    if (!botActive || !strategy || !primaryWallet) return;

    const interval = setInterval(async () => {
      const nowSec = Math.floor(Date.now() / 1000);

      for (const market of markets) {
        if (market.resolved || market.cancelled) continue;
        const timeLeft = market.expiry - nowSec;
        if (timeLeft <= 0 || timeLeft > strategy.triggerSecondsLeft) continue;
        if (bettedRef.current.has(market.id)) continue;
        if (userBets[market.id]) continue;

        if (betsCount >= strategy.maxBetsTotal) {
          addLog("info", `⚠️ Max bets reached (${strategy.maxBetsTotal}) — bot stopped`);
          setBotActive(false);
          return;
        }

        const parsed = parseMarketQuestion(market.question);
        if (!parsed) continue;

        // Asset filter
        if (!strategy.assets.includes("all") && !strategy.assets.includes(parsed.feedKey)) continue;

        const livePrice = livePrices[parsed.feedKey];
        if (!livePrice) {
          addLog("info", `⏳ No live price for ${parsed.feedKey} yet, skipping`);
          continue;
        }

        const priceAbove = livePrice > parsed.threshold;
        const betOption  = priceAbove ? parsed.optionIfAbove : 1 - parsed.optionIfAbove;
        const optionName = market.options[betOption] ?? `Option ${betOption}`;
        const priceFmt   = parsed.feedKey === "ETH_GAS"
          ? `${livePrice.toFixed(3)} gwei`
          : parsed.feedKey === "BTC/USD"
          ? `$${livePrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : `$${livePrice.toFixed(2)}`;
        const direction  = priceAbove ? "above" : "below";

        bettedRef.current.add(market.id); // prevent re-entry while tx is pending
        addLog("info", `🎯 Market #${market.id} | ${parsed.feedKey} live ${priceFmt} is ${direction} $${parsed.threshold} | ${timeLeft}s left → betting "${optionName}"`);

        try {
          await placeBotBet(market.id, betOption, strategy.betAmount);
          addLog("success", `✅ Bet #${betsCount + 1}: $${strategy.betAmount} USDC on "${optionName}" (market #${market.id})`);
          setBetsCount(p => p + 1);
          onBetPlaced();
        } catch (e: any) {
          const msg = (e.message ?? "").slice(0, 100);
          addLog("error", `❌ Bet failed on market #${market.id}: ${msg}`);
          bettedRef.current.delete(market.id); // allow retry
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botActive, strategy, markets, livePrices, userBets, primaryWallet, betsCount]);

  // ── Place bet using window.ethereum ─────────────────────────
  async function placeBotBet(marketId: number, optionIndex: number, amount: number) {
    const ethereum = (window as any).ethereum;
    if (!ethereum) throw new Error("No wallet found");

    const chainHex = await ethereum.request({ method: "eth_chainId" }) as string;
    if (parseInt(chainHex, 16) !== ARC_CHAIN_ID) {
      addLog("info", "🔄 Switching to Arc network...");
      try {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
      } catch (err: any) {
        if (err.code === 4902 || err.code === -32603) {
          await ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [ARC_RPC], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
        } else throw err;
      }
    }

    const provider = new ethers.BrowserProvider(ethereum);
    const signer   = await provider.getSigner();
    const usdcWei  = ethers.parseUnits(amount.toFixed(6), 6);

    const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
    const usdcRead    = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, arcProvider);
    const allowance   = await usdcRead.allowance(await signer.getAddress(), CONTRACT_ADDRESS);

    if (allowance < usdcWei) {
      addLog("info", "🔐 Requesting USDC approval (one-time)...");
      const usdcTx = await new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer).approve(CONTRACT_ADDRESS, ethers.MaxUint256);
      await usdcTx.wait();
    }

    const tx = await new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer).placeBet(marketId, optionIndex, usdcWei);
    await tx.wait();
  }

  // ── Colour helpers ───────────────────────────────────────────
  const LOG_STYLE: Record<LogEntry["type"], string> = {
    user:    "text-px-purple",
    ai:      "text-px-cyan",
    info:    "text-gray-400",
    success: "text-px-green",
    error:   "text-px-red",
  };

  const liveCount = markets.filter(m => !m.resolved && !m.cancelled && m.expiry > Math.floor(Date.now() / 1000)).length;

  return (
    <>
      {/* ── Floating trigger button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 font-pixel text-xs uppercase tracking-widest border-2 transition-all shadow-lg ${
          botActive
            ? "bg-px-green/20 border-px-green text-px-green animate-pulse"
            : "bg-px-card border-px-purple text-px-purple hover:bg-px-purple/20"
        }`}
      >
        <span className="text-lg">🤖</span>
        <span>{botActive ? `BOT ACTIVE · ${betsCount} bets` : "AI BOT"}</span>
      </button>

      {/* ── Slide-in panel ── */}
      <div className={`fixed bottom-0 right-0 z-40 h-[100dvh] w-full max-w-md flex flex-col bg-px-bg border-l-2 border-px-border transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>

        {/* Header */}
        <div className="bg-px-purple/20 border-b-2 border-px-border px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <span className="font-pixel font-bold text-px-purple text-sm uppercase tracking-widest">🤖 AI Trading Bot</span>
            <p className="font-pixel text-xs text-px-dim mt-0.5">Powered by 0G Compute · {liveCount} live markets</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-px-dim hover:text-white text-lg font-bold leading-none">✕</button>
        </div>

        {/* Status bar */}
        {strategy && (
          <div className={`px-4 py-2 border-b border-px-border flex items-center justify-between shrink-0 ${botActive ? "bg-px-green/10" : "bg-px-card"}`}>
            <div className="font-pixel text-xs">
              <span className={botActive ? "text-px-green" : "text-px-dim"}>
                {botActive ? "● RUNNING" : "○ READY"}
              </span>
              <span className="text-px-dim ml-3">Bets: {betsCount}/{strategy.maxBetsTotal}</span>
              <span className="text-px-dim ml-3">${strategy.betAmount}/bet</span>
            </div>
            <div className="flex gap-2">
              {!botActive ? (
                <button
                  onClick={() => {
                    if (!primaryWallet) { addLog("error", "Connect your wallet first"); return; }
                    bettedRef.current.clear();
                    setBotActive(true);
                    addLog("ai", `🚀 Bot activated! Watching ${strategy.assets.join(", ")} — will bet when ≤${strategy.triggerSecondsLeft}s remain`);
                  }}
                  className="btn-pixel bg-px-green text-black font-pixel text-xs px-3 py-1.5 uppercase tracking-wide"
                >
                  ▶ START
                </button>
              ) : (
                <button
                  onClick={() => { setBotActive(false); addLog("ai", "⏹ Bot stopped"); }}
                  className="btn-pixel bg-px-red/20 border border-px-red text-px-red font-pixel text-xs px-3 py-1.5 uppercase tracking-wide"
                >
                  ■ STOP
                </button>
              )}
            </div>
          </div>
        )}

        {/* Log window */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2 leading-relaxed">
              <span className="text-px-dim shrink-0">{l.ts}</span>
              <span className={LOG_STYLE[l.type]}>
                {l.type === "user" && <span className="text-px-purple font-bold">YOU: </span>}
                {l.message}
              </span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>

        {/* Suggestions */}
        {logs.length <= 2 && (
          <div className="px-3 pb-2 shrink-0">
            <p className="font-pixel text-xs text-px-dim uppercase tracking-widest mb-2">Try an example:</p>
            {SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                onClick={() => setInput(s)}
                className="w-full text-left font-sans text-xs text-px-dim hover:text-px-cyan border border-px-border hover:border-px-cyan px-3 py-2 mb-1 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t-2 border-px-border p-3 shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSend()}
              placeholder="Describe your strategy..."
              disabled={parsing}
              className="flex-1 bg-px-bg border border-px-border focus:border-px-purple px-3 py-2 text-white text-xs font-sans outline-none transition-colors placeholder:text-px-dim disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || parsing}
              className="btn-pixel bg-px-purple text-white font-pixel text-xs px-4 py-2 uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed hover:bg-purple-700 transition-colors"
            >
              {parsing ? "..." : "SEND"}
            </button>
          </div>
          {!primaryWallet && (
            <p className="font-pixel text-xs text-px-red mt-2 uppercase tracking-widest">⚠ Connect wallet to activate bot</p>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setOpen(false)} />}
    </>
  );
}
