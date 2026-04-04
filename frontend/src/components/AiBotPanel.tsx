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

// Session wallet — ephemeral key held only in memory, never persisted
interface SessionWallet {
  wallet:   ethers.NonceManager;
  address:  string;
  budget:   number;
  spent:    number;
}

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

// Arc tx takes ~5s to mine. Fire within: MIN_BET_SECS <= timeLeft <= triggerSecondsLeft
const MIN_TRIGGER_SECS = 20;
const MIN_BET_SECS     = 15;

const SUGGESTIONS = [
  "Bet $0.1 on ETH price markets when 20s left, bet on whichever side Chainlink favors",
  "Auto-bet $0.5 on BTC and SOL markets under 30 seconds, max 5 bets",
  "Watch all price markets, bet $0.2 on the likely winner when 25 seconds remain",
];

export function AiBotPanel({ markets, livePrices, userBets, onBetPlaced }: Props) {
  const { primaryWallet } = useDynamicContext();

  const [open,          setOpen]          = useState(false);
  const [input,         setInput]         = useState("");
  const [logs,          setLogs]          = useState<LogEntry[]>([]);
  const [strategy,      setStrategy]      = useState<BotStrategy | null>(null);
  const [botActive,     setBotActive]     = useState(false);
  const [parsing,       setParsing]       = useState(false);
  const [betsCount,     setBetsCount]     = useState(0);
  const [sessionWallet, setSessionWallet] = useState<SessionWallet | null>(null);
  const [funding,       setFunding]       = useState(false);
  const [budgetInput,   setBudgetInput]   = useState("2");

  const bettedRef  = useRef<Set<number>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs([{ ts: timestamp(), type: "ai", message: "👋 Describe a trading strategy in plain English. Enable Auto Mode to let the bot trade without wallet popups." }]);
  }, []);

  function addLog(type: LogEntry["type"], message: string) {
    setLogs(prev => [...prev.slice(-99), { ts: timestamp(), type, message }]);
  }

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Create session wallet and fund it from user's main wallet ──
  async function enableAutoMode() {
    const ethereum = (window as any).ethereum;
    if (!ethereum || !primaryWallet) {
      addLog("error", "Connect your wallet first");
      return;
    }
    const budget = parseFloat(budgetInput);
    if (isNaN(budget) || budget < 0.1) {
      addLog("error", "Minimum budget is 0.1 USDC");
      return;
    }

    setFunding(true);
    addLog("ai", `🔐 Creating session wallet (in-memory, never stored)...`);

    try {
      // Switch to Arc
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

      // Generate ephemeral keypair, wrap in NonceManager so concurrent bets don't collide
      const ephemeral   = ethers.Wallet.createRandom();
      const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
      const hotWallet   = new ethers.NonceManager(ephemeral.connect(arcProvider));

      const sessionAddr = await hotWallet.getAddress();
      addLog("info", `🆕 Session wallet: ${sessionAddr.slice(0, 10)}…`);
      addLog("info", `💸 One MetaMask popup to fund it with $${budget} USDC — then the bot runs silently`);

      // Fund from user's main wallet (one popup)
      const provider   = new ethers.BrowserProvider(ethereum);
      const signer     = await provider.getSigner();
      const usdcWei    = ethers.parseUnits(budget.toFixed(6), 6);
      const USDC_FULL_ABI = [
        "function approve(address spender, uint256 amount) returns (bool)",
        "function transfer(address to, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)",
      ];
      const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_FULL_ABI, signer);

      addLog("info", "💳 Transferring USDC to session wallet (MetaMask popup)...");
      const transferTx = await usdcContract.transfer(sessionAddr, usdcWei);
      await transferTx.wait();

      // Pre-approve contract from session wallet (no popup — signed by in-memory key)
      addLog("info", "🔓 Pre-approving contract spend from session wallet (no popup)...");
      const USDC_APPROVE_ABI = ["function approve(address spender, uint256 amount) returns (bool)"];
      const hotUsdc = new ethers.Contract(USDC_ADDRESS, USDC_APPROVE_ABI, hotWallet);
      const approveTx2 = await hotUsdc.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
      await approveTx2.wait();

      const sessionAddress = await hotWallet.getAddress();
      setSessionWallet({ wallet: hotWallet, address: sessionAddress, budget, spent: 0 });
      addLog("success", `✅ Auto Mode enabled! Session wallet funded with $${budget} USDC`);
      addLog("ai", `🤖 Bot will now place bets silently — no more popups. Press START when ready.`);
    } catch (e: any) {
      addLog("error", `Setup failed: ${(e.message ?? "").slice(0, 120)}`);
    } finally {
      setFunding(false);
    }
  }

  function revokeSession() {
    setSessionWallet(null);
    setBotActive(false);
    addLog("info", "🔒 Session wallet revoked. Funds remain at the session address — use your wallet to recover them.");
  }

  // ── Parse strategy ───────────────────────────────────────────
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
        const safeTrigger = Math.max(data.strategy.triggerSecondsLeft, MIN_TRIGGER_SECS);
        const strat: BotStrategy = { ...data.strategy, triggerSecondsLeft: safeTrigger };
        setStrategy(strat);
        setBetsCount(0);
        bettedRef.current.clear();
        setBotActive(false);
        const src = data.source === "0g-ai" ? "0G Compute (LLaMA-70B)" : "keyword parser";
        addLog("ai", `✅ Strategy parsed via ${src}: ${strat.description}`);
        if (safeTrigger > data.strategy.triggerSecondsLeft) {
          addLog("info", `⚠️ Trigger raised to ${safeTrigger}s (Arc needs ~5s to mine)`);
        }
        addLog("ai", `⚙️ Assets: ${strat.assets.join(", ")} · ≤${strat.triggerSecondsLeft}s · $${strat.betAmount}/bet · max ${strat.maxBetsTotal}`);
        if (!sessionWallet) {
          addLog("ai", `👆 Enable Auto Mode below to trade without popups, or press START to use MetaMask.`);
        } else {
          addLog("ai", `▶ Press START BOT — session wallet will place bets silently.`);
        }
      } else {
        addLog("error", `Could not parse: ${data.error ?? "unknown"}`);
      }
    } catch (e: any) {
      addLog("error", `Error: ${e.message}`);
    } finally {
      setParsing(false);
    }
  }

  // ── Bot loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (!botActive || !strategy) return;

    const interval = setInterval(async () => {
      const nowSec = Math.floor(Date.now() / 1000);

      for (const market of markets) {
        if (market.resolved || market.cancelled) continue;
        const timeLeft = market.expiry - nowSec;
        if (timeLeft <= 0 || timeLeft > strategy.triggerSecondsLeft) continue;
        if (timeLeft < MIN_BET_SECS) {
          if (!bettedRef.current.has(market.id)) {
            addLog("info", `⏭ #${market.id} skipped — only ${timeLeft}s left`);
            bettedRef.current.add(market.id);
          }
          continue;
        }
        if (bettedRef.current.has(market.id)) continue;
        if (userBets[market.id]) continue;

        if (betsCount >= strategy.maxBetsTotal) {
          addLog("info", `⚠️ Max bets (${strategy.maxBetsTotal}) reached — stopping`);
          setBotActive(false);
          return;
        }

        // Budget check for session wallet
        if (sessionWallet && sessionWallet.spent + strategy.betAmount > sessionWallet.budget) {
          addLog("info", `⚠️ Session budget exhausted ($${sessionWallet.spent.toFixed(2)}/$${sessionWallet.budget}) — stopping`);
          setBotActive(false);
          return;
        }

        const parsed = parseMarketQuestion(market.question);
        if (!parsed) continue;
        if (!strategy.assets.includes("all") && !strategy.assets.includes(parsed.feedKey)) continue;

        const livePrice = livePrices[parsed.feedKey];
        if (!livePrice) continue;

        const priceAbove = livePrice > parsed.threshold;
        const betOption  = priceAbove ? parsed.optionIfAbove : 1 - parsed.optionIfAbove;
        const optionName = market.options[betOption] ?? `Option ${betOption}`;
        const priceFmt   = parsed.feedKey === "BTC/USD"
          ? `$${livePrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : parsed.feedKey === "ETH_GAS" ? `${livePrice.toFixed(3)} gwei` : `$${livePrice.toFixed(2)}`;

        bettedRef.current.add(market.id);
        const mode = sessionWallet ? "🤫 silent" : "🔔 MetaMask";
        addLog("info", `🎯 #${market.id} | ${parsed.feedKey} ${priceFmt} ${priceAbove ? ">" : "<"} $${parsed.threshold} | ${timeLeft}s | ${mode} → "${optionName}"`);

        try {
          if (sessionWallet) {
            await placeSilentBet(sessionWallet.wallet, market.id, betOption, strategy.betAmount);
            setSessionWallet(sw => sw ? { ...sw, spent: sw.spent + strategy.betAmount } : sw);
          } else {
            await placeMetaMaskBet(market.id, betOption, strategy.betAmount);
          }
          addLog("success", `✅ Bet #${betsCount + 1}: $${strategy.betAmount} on "${optionName}" (market #${market.id})`);
          setBetsCount(p => p + 1);
          onBetPlaced();
        } catch (e: any) {
          addLog("error", `❌ Market #${market.id}: ${(e.message ?? "").slice(0, 80)}`);
          bettedRef.current.delete(market.id);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botActive, strategy, markets, livePrices, userBets, betsCount, sessionWallet]);

  // ── Silent bet (session wallet, no popup) ────────────────────
  async function placeSilentBet(wallet: ethers.NonceManager, marketId: number, optionIndex: number, amount: number) {
    const usdcWei   = ethers.parseUnits(amount.toFixed(6), 6);
    const contract  = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
    const tx        = await contract.placeBet(marketId, optionIndex, usdcWei);
    await tx.wait();
  }

  // ── MetaMask bet fallback ────────────────────────────────────
  async function placeMetaMaskBet(marketId: number, optionIndex: number, amount: number) {
    const ethereum = (window as any).ethereum;
    if (!ethereum) throw new Error("No wallet found");

    const chainHex = await ethereum.request({ method: "eth_chainId" }) as string;
    if (parseInt(chainHex, 16) !== ARC_CHAIN_ID) {
      try {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
      } catch (err: any) {
        if (err.code === 4902 || err.code === -32603) {
          await ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [ARC_RPC], blockExplorerUrls: ["https://testnet.arcscan.app"] }] });
        } else throw err;
      }
    }

    const provider   = new ethers.BrowserProvider(ethereum);
    const signer     = await provider.getSigner();
    const usdcWei    = ethers.parseUnits(amount.toFixed(6), 6);
    const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
    const allowance  = await new ethers.Contract(USDC_ADDRESS, ERC20_ABI, arcProvider)
      .allowance(await signer.getAddress(), CONTRACT_ADDRESS);

    if (allowance < usdcWei) {
      const approveTx = await new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer).approve(CONTRACT_ADDRESS, ethers.MaxUint256);
      await approveTx.wait();
    }
    const tx = await new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer).placeBet(marketId, optionIndex, usdcWei);
    await tx.wait();
  }

  const LOG_STYLE: Record<LogEntry["type"], string> = {
    user: "text-px-purple", ai: "text-px-cyan", info: "text-gray-400", success: "text-px-green", error: "text-px-red",
  };
  const liveCount = markets.filter(m => !m.resolved && !m.cancelled && m.expiry > Math.floor(Date.now() / 1000)).length;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 font-pixel text-xs uppercase tracking-widest border-2 transition-all shadow-lg ${open ? "hidden" : ""} ${
          botActive ? "bg-px-green/20 border-px-green text-px-green animate-pulse" : "bg-px-card border-px-purple text-px-purple hover:bg-px-purple/20"
        }`}
      >
        <span className="text-lg">🤖</span>
        <span>{botActive ? `BOT ACTIVE · ${betsCount} bets` : "AI BOT"}</span>
      </button>

      {/* Panel */}
      <div className={`fixed bottom-0 right-0 z-40 h-[100dvh] w-full max-w-md flex flex-col bg-px-bg border-l-2 border-px-border transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}>

        {/* Header */}
        <div className="bg-px-purple/20 border-b-2 border-px-border px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <span className="font-pixel font-bold text-px-purple text-sm uppercase tracking-widest">🤖 AI Trading Bot</span>
            <p className="font-pixel text-xs text-px-dim mt-0.5">
              {sessionWallet ? `🔑 Auto Mode · $${sessionWallet.spent.toFixed(2)}/$${sessionWallet.budget} spent` : "Powered by 0G Compute"} · {liveCount} live
            </p>
          </div>
          <button onClick={() => setOpen(false)} className="text-px-dim hover:text-white text-lg font-bold leading-none">✕</button>
        </div>

        {/* Status bar */}
        {strategy && (
          <div className={`px-4 py-2 border-b border-px-border flex items-center justify-between shrink-0 ${botActive ? "bg-px-green/10" : "bg-px-card"}`}>
            <div className="font-pixel text-xs">
              <span className={botActive ? "text-px-green" : "text-px-dim"}>{botActive ? "● RUNNING" : "○ READY"}</span>
              <span className="text-px-dim ml-3">{betsCount}/{strategy.maxBetsTotal} bets</span>
              {sessionWallet && <span className="text-px-cyan ml-3">🤫 SILENT</span>}
            </div>
            <div className="flex gap-2">
              {!botActive ? (
                <button
                  onClick={() => {
                    if (!primaryWallet && !sessionWallet) { addLog("error", "Connect wallet first"); return; }
                    bettedRef.current.clear();
                    setBotActive(true);
                    addLog("ai", `🚀 Bot running! ${sessionWallet ? "Silent mode — no popups." : "MetaMask will prompt each bet."} Watching ${strategy.assets.join(", ")} ≤${strategy.triggerSecondsLeft}s`);
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

        {/* Log */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
          {logs.map((l, i) => (
            <div key={i} className="flex gap-2 leading-relaxed">
              <span className="text-px-dim shrink-0">{l.ts}</span>
              <span className={LOG_STYLE[l.type]}>
                {l.type === "user" && <span className="font-bold">YOU: </span>}
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
              <button key={i} onClick={() => setInput(s)}
                className="w-full text-left font-sans text-xs text-px-dim hover:text-px-cyan border border-px-border hover:border-px-cyan px-3 py-2 mb-1 transition-colors">
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Auto Mode setup */}
        <div className={`border-t border-px-border px-3 py-3 shrink-0 ${sessionWallet ? "bg-px-green/5" : "bg-px-card"}`}>
          {!sessionWallet ? (
            <div>
              <p className="font-pixel text-xs text-px-cyan uppercase tracking-widest mb-2">
                ⚡ Auto Mode — no popups per bet
              </p>
              <p className="font-sans text-xs text-px-dim mb-2">
                Fund a session wallet once → bot trades silently. Key exists only in memory, never saved.
              </p>
              <div className="flex gap-2 items-center">
                <span className="font-pixel text-xs text-px-dim">Budget:</span>
                <input
                  type="number" min="0.1" step="0.1" value={budgetInput}
                  onChange={e => setBudgetInput(e.target.value)}
                  className="w-20 bg-px-bg border border-px-border px-2 py-1 text-white text-xs font-sans outline-none focus:border-px-cyan"
                />
                <span className="font-pixel text-xs text-px-dim">USDC</span>
                <button
                  onClick={enableAutoMode}
                  disabled={funding || !primaryWallet}
                  className="flex-1 btn-pixel bg-px-cyan/20 border border-px-cyan text-px-cyan font-pixel text-xs px-3 py-1.5 uppercase tracking-wide disabled:opacity-40 hover:bg-px-cyan/30 transition-colors"
                >
                  {funding ? "SETTING UP..." : "ENABLE"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-pixel text-xs text-px-green uppercase tracking-widest">✓ Auto Mode Active</p>
                <p className="font-sans text-xs text-px-dim mt-0.5">
                  {sessionWallet.address.slice(0, 10)}… · ${(sessionWallet.budget - sessionWallet.spent).toFixed(2)} remaining
                </p>
              </div>
              <button onClick={revokeSession}
                className="btn-pixel border border-px-border text-px-dim hover:border-px-red hover:text-px-red font-pixel text-xs px-3 py-1.5 uppercase transition-colors">
                REVOKE
              </button>
            </div>
          )}
        </div>

        {/* Chat input */}
        <div className="border-t-2 border-px-border p-3 shrink-0">
          <div className="flex gap-2">
            <input
              type="text" value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSend()}
              placeholder="Describe your strategy..."
              disabled={parsing}
              className="flex-1 bg-px-bg border border-px-border focus:border-px-purple px-3 py-2 text-white text-xs font-sans outline-none transition-colors placeholder:text-px-dim disabled:opacity-50"
            />
            <button onClick={handleSend} disabled={!input.trim() || parsing}
              className="btn-pixel bg-px-purple text-white font-pixel text-xs px-4 py-2 uppercase tracking-wide disabled:opacity-40 hover:bg-purple-700 transition-colors">
              {parsing ? "..." : "SEND"}
            </button>
          </div>
        </div>
      </div>

      {open && <div className="fixed inset-0 z-30 bg-black/40" onClick={() => setOpen(false)} />}
    </>
  );
}
