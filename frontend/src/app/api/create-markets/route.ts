import { NextResponse } from "next/server";
import { ethers } from "ethers";

export const maxDuration = 60; // seconds — Next.js route timeout

// ── Config ────────────────────────────────────────────────────────────────────
const ARC_RPC          = process.env.NEXT_PUBLIC_ARC_RPC_URL    ?? "https://rpc.testnet.arc.network";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
const DEPLOYER_KEY     = process.env.DEPLOYER_PRIVATE_KEY!;
const DURATION_SECS    = parseInt(process.env.MARKET_DURATION_SECONDS ?? "120");
const ETH_RPC          = "https://ethereum-rpc.publicnode.com";

const CONTRACT_ABI = [
  "function createMarket(string question, string[] options, uint256 expiry, string storageHash) returns (uint256)",
  "function marketCount() view returns (uint256)",
  "function resolveMarket(uint256 marketId, uint256 winningOption)",
];

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

const FEEDS: Record<string, string> = {
  "ETH/USD":  "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  "SOL/USD":  "0x4ffC43a60e009B551865A93d232E33Fce9f01507",
  "ETH_GAS":  "0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C",
};

// ── Read a single feed with timeout ──────────────────────────────────────────
async function readFeed(provider: ethers.JsonRpcProvider, key: string) {
  const address = FEEDS[key];
  if (!address) return null;
  try {
    const c   = new ethers.Contract(address.toLowerCase(), AGGREGATOR_ABI, provider);
    const [rd, dec] = await Promise.all([
      c.latestRoundData(),
      c.decimals(),
    ]);
    const divisor = key === "ETH_GAS" ? 1e9 : Math.pow(10, Number(dec));
    return { value: Number(rd.answer) / divisor, raw: BigInt(rd.answer) };
  } catch {
    return null;
  }
}

// ── Build 2 markets from live data ───────────────────────────────────────────
async function buildMarkets() {
  const provider = new ethers.JsonRpcProvider(ETH_RPC);

  // Fetch all feeds in parallel with a 8s timeout
  const timeout = new Promise<null[]>((res) => setTimeout(() => res([null, null, null]), 8000));
  const feeds = await Promise.race([
    Promise.all([
      readFeed(provider, "ETH/USD"),
      readFeed(provider, "SOL/USD"),
      readFeed(provider, "ETH_GAS"),
    ]),
    timeout,
  ]);

  const [eth, sol, gas] = feeds;
  const dMin = DURATION_SECS / 60;

  const markets: Array<{
    question: string;
    options: string[];
    storageHash: string;
    autoResolve: { feedKey: string; rawThreshold: bigint; optionIfAbove: number };
  }> = [];

  // Always include ETH (or fallback to hardcoded if feed unavailable)
  const ethVal = eth?.value ?? 2000;
  const ethSupport = Math.round(ethVal * 0.99 / 50) * 50;
  markets.push({
    question:    `Will ETH/USD hold above $${ethSupport.toLocaleString()} in ${dMin}min? (Now: $${ethVal.toLocaleString("en-US", { maximumFractionDigits: 0 })})`,
    options:     [`Yes, holds above $${ethSupport.toLocaleString()}`, `No, breaks below`],
    storageHash: `0g://mock-eth-${Date.now()}`,
    autoResolve: { feedKey: "ETH/USD", rawThreshold: BigInt(Math.floor(ethSupport * 1e8)), optionIfAbove: 0 },
  });

  // SOL or gas as second market
  if (sol) {
    const target = Math.round(sol.value * 1.02 * 100) / 100;
    markets.push({
      question:    `Will SOL/USD exceed $${target.toFixed(2)} in ${dMin}min? (Now: $${sol.value.toFixed(2)})`,
      options:     [`Yes, above $${target.toFixed(2)}`, `No, stays below`],
      storageHash: `0g://mock-sol-${Date.now()}`,
      autoResolve: { feedKey: "SOL/USD", rawThreshold: BigInt(Math.floor(target * 1e8)), optionIfAbove: 0 },
    });
  } else if (gas) {
    const threshold = Math.max(gas.value * 1.5, 0.01);
    const tStr = threshold >= 1 ? threshold.toFixed(0) : threshold.toFixed(2);
    const gStr = gas.value >= 1 ? gas.value.toFixed(1) : gas.value.toFixed(2);
    markets.push({
      question:    `Will ETH gas spike above ${tStr} gwei in ${dMin}min? (Now: ${gStr} gwei)`,
      options:     [`Yes, spikes above ${tStr} gwei`, `No, stays below`],
      storageHash: `0g://mock-gas-${Date.now()}`,
      autoResolve: { feedKey: "ETH_GAS", rawThreshold: BigInt(Math.floor(threshold * 1e9)), optionIfAbove: 0 },
    });
  }

  return markets;
}

// ── Auto-resolve after expiry ─────────────────────────────────────────────────
function scheduleResolution(
  wallet: ethers.Wallet,
  marketId: number,
  feedKey: string,
  rawThreshold: bigint,
  optionIfAbove: number,
) {
  const delayMs = (DURATION_SECS + 8) * 1000;
  setTimeout(async () => {
    try {
      const ethProvider = new ethers.JsonRpcProvider(ETH_RPC);
      const feed = FEEDS[feedKey];
      if (!feed) return;
      const c   = new ethers.Contract(feed.toLowerCase(), AGGREGATOR_ABI, ethProvider);
      const rd  = await c.latestRoundData();
      const ans = BigInt(rd.answer);
      const win = ans > rawThreshold ? optionIfAbove : 1 - optionIfAbove;

      const arcWallet = wallet.connect(new ethers.JsonRpcProvider(ARC_RPC));
      const contract  = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, arcWallet);
      const tx        = await contract.resolveMarket(marketId, win);
      await tx.wait();
      console.log(`[resolve] Market ${marketId} → option ${win}. TX: ${tx.hash}`);
    } catch (err: any) {
      console.error(`[resolve] Market ${marketId}: ${err.message}`);
    }
  }, delayMs);
}

// ── POST /api/create-markets ──────────────────────────────────────────────────
export async function POST() {
  if (!DEPLOYER_KEY || !CONTRACT_ADDRESS) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  try {
    const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
    const wallet      = new ethers.Wallet(DEPLOYER_KEY, arcProvider);
    const iface       = new ethers.Interface(CONTRACT_ABI);

    const markets = await buildMarkets();
    if (markets.length === 0) {
      return NextResponse.json({ error: "No markets built" }, { status: 500 });
    }

    // Get starting market ID once
    const startId = Number(
      await new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, arcProvider).marketCount()
    );

    const created: number[] = [];

    for (let i = 0; i < markets.length; i++) {
      const m        = markets[i];
      const marketId = startId + i;
      const expiry   = Math.floor(Date.now() / 1000) + DURATION_SECS;

      const data = iface.encodeFunctionData("createMarket", [
        m.question, m.options, expiry, m.storageHash,
      ]);

      // Send tx and wait for confirmation
      const tx = await wallet.sendTransaction({ to: CONTRACT_ADDRESS, data });
      await tx.wait();
      created.push(marketId);

      scheduleResolution(wallet, marketId, m.autoResolve.feedKey, m.autoResolve.rawThreshold, m.autoResolve.optionIfAbove);
    }

    return NextResponse.json({ created, count: created.length });
  } catch (err: any) {
    console.error("[create-markets]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
