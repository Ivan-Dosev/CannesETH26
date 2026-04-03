import { NextResponse } from "next/server";
import { ethers } from "ethers";

const ARC_RPC          = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
const DEPLOYER_KEY     = process.env.DEPLOYER_PRIVATE_KEY!;
const ETH_RPC          = "https://ethereum-rpc.publicnode.com";

const CONTRACT_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
  "function resolveMarket(uint256 marketId, uint256 winningOption)",
];

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
];

const FEEDS: Record<string, { address: string; divisor?: number }> = {
  "ETH/USD":  { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" },
  "SOL/USD":  { address: "0x4ffC43a60e009B551865A93d232E33Fce9f01507" },
  "BTC/USD":  { address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c" },
  "AVAX/USD": { address: "0xFF3EEb22B5E3dE6e705b44749C2559d704923FD7" },
  "ETH_GAS":  { address: "0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C", divisor: 1e9 },
};

// Parse the market question to extract feed key, threshold, and direction
function parseMarket(question: string): { feedKey: string; rawThreshold: bigint; optionIfAbove: number } | null {
  // Determine direction: "below/drop/fall/stay below/sink" = bearish (optionIfAbove=1)
  const isBearish = /drop below|fall below|sink below|stay below|drops below|falls below/i.test(question);

  // ETH gas questions
  const gasAbove = question.match(/gas.*?(?:spike above|exceed)\s+([0-9.]+)\s+gwei/i);
  if (gasAbove) {
    return { feedKey: "ETH_GAS", rawThreshold: BigInt(Math.round(parseFloat(gasAbove[1]) * 1e9)), optionIfAbove: 0 };
  }
  const gasBelow = question.match(/gas.*?stay below\s+([0-9.]+)\s+gwei/i);
  if (gasBelow) {
    return { feedKey: "ETH_GAS", rawThreshold: BigInt(Math.round(parseFloat(gasBelow[1]) * 1e9)), optionIfAbove: 1 };
  }

  // Asset/USD price questions — extract asset and price
  const assetMatch = question.match(/Will\s+(ETH|SOL|BTC|AVAX)\/USD.*?\$([0-9,]+(?:\.[0-9]+)?)/i);
  if (assetMatch) {
    const asset = assetMatch[1].toUpperCase();
    const price = parseFloat(assetMatch[2].replace(/,/g, ""));
    return {
      feedKey:       `${asset}/USD`,
      rawThreshold:  BigInt(Math.round(price * 1e8)),
      optionIfAbove: isBearish ? 1 : 0,
    };
  }

  return null;
}

// Prevent concurrent resolution runs
let resolving = false;

export async function POST() {
  if (!DEPLOYER_KEY || !CONTRACT_ADDRESS) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  if (resolving) {
    return NextResponse.json({ skipped: "already running" });
  }

  resolving = true;
  const resolved: number[] = [];
  const failed:   number[] = [];

  try {
    const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
    const ethProvider = new ethers.JsonRpcProvider(ETH_RPC);
    const wallet      = new ethers.Wallet(DEPLOYER_KEY, arcProvider);
    const contract    = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    const count = Number(await contract.marketCount());
    const now   = Math.floor(Date.now() / 1000);

    // Find expired but unresolved markets
    const pending: { id: number; question: string }[] = [];
    for (let i = 0; i < count; i++) {
      const m = await contract.getMarket(i);
      if (!m.resolved && !m.cancelled && now >= Number(m.expiry)) {
        pending.push({ id: i, question: m.question });
      }
    }

    if (pending.length === 0) {
      return NextResponse.json({ resolved: [], message: "Nothing to resolve" });
    }

    // Cache Chainlink prices to avoid redundant calls
    const priceCache: Record<string, bigint> = {};

    for (const { id, question } of pending) {
      try {
        const parsed = parseMarket(question);
        if (!parsed) {
          console.warn(`[resolve-pending] Can't parse market ${id}: ${question}`);
          continue;
        }

        const { feedKey, rawThreshold, optionIfAbove } = parsed;

        if (!priceCache[feedKey]) {
          const feed = FEEDS[feedKey];
          const c    = new ethers.Contract(feed.address.toLowerCase(), AGGREGATOR_ABI, ethProvider);
          const rd   = await c.latestRoundData();
          priceCache[feedKey] = BigInt(rd[1]);
        }

        const livePrice = priceCache[feedKey];
        const winner    = livePrice > rawThreshold ? optionIfAbove : 1 - optionIfAbove;

        const tx = await contract.resolveMarket(id, winner);
        await tx.wait();
        resolved.push(id);
        console.log(`[resolve-pending] Market ${id} resolved → option ${winner} (price ${livePrice} vs threshold ${rawThreshold})`);
      } catch (err: any) {
        console.error(`[resolve-pending] Market ${id} failed: ${err.message}`);
        failed.push(id);
      }
    }
  } finally {
    resolving = false;
  }

  return NextResponse.json({ resolved, failed });
}
