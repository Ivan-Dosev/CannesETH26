import { NextResponse } from "next/server";
import { ethers } from "ethers";
import OpenAI from "openai";
import { withDeployerLock } from "@/lib/deployerLock";

export const maxDuration = 60;

const ARC_RPC          = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
const DEPLOYER_KEY     = process.env.DEPLOYER_PRIVATE_KEY!;
const DURATION_SECS    = parseInt(process.env.MARKET_DURATION_SECONDS ?? "120");
const ETH_RPC          = "https://ethereum-rpc.publicnode.com";
const ZG_API_KEY       = process.env.ZG_API_KEY ?? "";
const ZG_ENDPOINT      = process.env.ZG_COMPUTE_ENDPOINT ?? "https://api.0g.ai/v1";

const CONTRACT_ABI = [
  "function createMarket(string question, string[] options, uint256 expiry, string storageHash) returns (uint256)",
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
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

interface FeedData { value: number; raw: bigint }
interface MarketSpec {
  question: string; options: string[];
  feedKey: string; rawThreshold: bigint; optionIfAbove: number;
}

async function readFeed(provider: ethers.JsonRpcProvider, key: string): Promise<FeedData | null> {
  const cfg = FEEDS[key];
  if (!cfg) return null;
  try {
    const c = new ethers.Contract(cfg.address.toLowerCase(), AGGREGATOR_ABI, provider);
    const [rd, dec] = await Promise.all([c.latestRoundData(), c.decimals()]);
    const divisor = cfg.divisor ?? Math.pow(10, Number(dec));
    return { value: Number(rd[1]) / divisor, raw: BigInt(rd[1]) };
  } catch { return null; }
}

// ── Ask 0G Compute (LLaMA-70B) to generate creative markets ──────────────────
async function generateWithAI(prices: Record<string, number>, dMin: number): Promise<MarketSpec[]> {
  const client = new OpenAI({ baseURL: ZG_ENDPOINT, apiKey: ZG_API_KEY });

  const priceContext = Object.entries(prices)
    .map(([k, v]) => `${k === "ETH_GAS" ? "ETH Gas" : k}: ${k === "ETH_GAS" ? v.toFixed(3) + " gwei" : k === "BTC/USD" ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "$" + v.toFixed(2)}`)
    .join("\n");

  const systemPrompt = `You are an AI generating prediction market questions for a DeFi prediction platform.
Markets are binary (Yes/No) and resolve in ${dMin} minutes using live Chainlink oracle prices.
You MUST set thresholds at realistic levels — within ±3% of current price so the outcome is genuinely uncertain.
Be creative: vary between bullish (above), bearish (below), and stability questions.
Mix different assets — don't always pick the same one.`;

  const userPrompt = `Live Chainlink oracle prices right now:
${priceContext}

Generate 2 interesting and DIFFERENT prediction market questions.
Respond ONLY with valid JSON:
{
  "markets": [
    {
      "question": "Will X/USD [action] $[threshold] in ${dMin}min?",
      "options": ["Yes, [specific outcome]", "No, [opposite outcome]"],
      "feedKey": "ETH/USD" | "SOL/USD" | "BTC/USD" | "AVAX/USD" | "ETH_GAS",
      "threshold": <number — exact price or gwei value>,
      "optionIfAbove": 0 or 1
    }
  ]
}
optionIfAbove=0 means option 0 ("Yes") wins when price is ABOVE threshold (bullish/above questions).
optionIfAbove=1 means option 0 ("Yes") wins when price is BELOW threshold (bearish/below questions).
Do NOT repeat the same asset twice. Be creative with question wording.`;

  const res = await client.chat.completions.create({
    model:           "neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8",
    messages:        [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    temperature:     0.8,
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content ?? "{}";
  const parsed  = JSON.parse(content);
  const items   = parsed.markets ?? [];

  const result: MarketSpec[] = [];
  for (const m of items) {
    if (!m.question || !m.options || !m.feedKey || m.threshold == null) continue;
    const isGas = m.feedKey === "ETH_GAS";
    const rawThreshold = isGas
      ? BigInt(Math.round(Number(m.threshold) * 1e9))
      : BigInt(Math.round(Number(m.threshold) * 1e8));
    result.push({
      question:      m.question,
      options:       m.options,
      feedKey:       m.feedKey,
      rawThreshold,
      optionIfAbove: Number(m.optionIfAbove ?? 0),
    });
  }
  return result;
}

// ── Deterministic fallback when no ZG_API_KEY ────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fallbackPool(feeds: Record<string, FeedData | null>, dMin: number): MarketSpec[] {
  const pool: MarketSpec[] = [];
  const { "ETH/USD": eth, "SOL/USD": sol, "BTC/USD": btc, "AVAX/USD": avax, ETH_GAS: gas } = feeds;

  if (eth) {
    const v = eth.value;
    pool.push({ question: `Will ETH/USD hold above $${Math.round(v*0.99/50)*50} in ${dMin}min?`, options: ["Yes, holds above", "No, breaks below"], feedKey: "ETH/USD", rawThreshold: BigInt(Math.round(Math.round(v*0.99/50)*50 * 1e8)), optionIfAbove: 0 });
    pool.push({ question: `Will ETH/USD break above $${Math.round(v*1.01/50)*50} in ${dMin}min?`, options: ["Yes, breaks above", "No, stays below"], feedKey: "ETH/USD", rawThreshold: BigInt(Math.round(Math.round(v*1.01/50)*50 * 1e8)), optionIfAbove: 0 });
    pool.push({ question: `Will ETH/USD drop below $${Math.round(v*0.97/50)*50} in ${dMin}min?`, options: ["Yes, drops below", "No, stays above"], feedKey: "ETH/USD", rawThreshold: BigInt(Math.round(Math.round(v*0.97/50)*50 * 1e8)), optionIfAbove: 1 });
  }
  if (sol) {
    const v = sol.value;
    pool.push({ question: `Will SOL/USD exceed $${(v*1.02).toFixed(2)} in ${dMin}min?`, options: ["Yes, above", "No, stays below"], feedKey: "SOL/USD", rawThreshold: BigInt(Math.round(v*1.02*1e8)), optionIfAbove: 0 });
    pool.push({ question: `Will SOL/USD fall below $${(v*0.97).toFixed(2)} in ${dMin}min?`, options: ["Yes, drops below", "No, stays above"], feedKey: "SOL/USD", rawThreshold: BigInt(Math.round(v*0.97*1e8)), optionIfAbove: 1 });
  }
  if (btc) {
    const v = btc.value;
    pool.push({ question: `Will BTC/USD hold above $${Math.round(v*0.99/500)*500} in ${dMin}min?`, options: ["Yes, holds above", "No, breaks below"], feedKey: "BTC/USD", rawThreshold: BigInt(Math.round(Math.round(v*0.99/500)*500 * 1e8)), optionIfAbove: 0 });
    pool.push({ question: `Will BTC/USD break above $${Math.round(v*1.01/500)*500} in ${dMin}min?`, options: ["Yes, breaks above", "No, stays below"], feedKey: "BTC/USD", rawThreshold: BigInt(Math.round(Math.round(v*1.01/500)*500 * 1e8)), optionIfAbove: 0 });
    pool.push({ question: `Will BTC/USD drop below $${Math.round(v*0.97/500)*500} in ${dMin}min?`, options: ["Yes, drops below", "No, stays above"], feedKey: "BTC/USD", rawThreshold: BigInt(Math.round(Math.round(v*0.97/500)*500 * 1e8)), optionIfAbove: 1 });
  }
  if (avax) {
    const v = avax.value;
    pool.push({ question: `Will AVAX/USD exceed $${(v*1.03).toFixed(2)} in ${dMin}min?`, options: ["Yes, above", "No, stays below"], feedKey: "AVAX/USD", rawThreshold: BigInt(Math.round(v*1.03*1e8)), optionIfAbove: 0 });
    pool.push({ question: `Will AVAX/USD fall below $${(v*0.97).toFixed(2)} in ${dMin}min?`, options: ["Yes, drops below", "No, stays above"], feedKey: "AVAX/USD", rawThreshold: BigInt(Math.round(v*0.97*1e8)), optionIfAbove: 1 });
  }
  if (gas) {
    const v = gas.value;
    const spike = Math.max(v*2, 0.01); const low = Math.max(v*1.5, 0.01);
    pool.push({ question: `Will ETH gas spike above ${spike.toFixed(2)} gwei in ${dMin}min?`, options: ["Yes, spikes", "No, stays low"], feedKey: "ETH_GAS", rawThreshold: BigInt(Math.round(spike*1e9)), optionIfAbove: 0 });
    pool.push({ question: `Will ETH gas stay below ${low.toFixed(2)} gwei in ${dMin}min?`, options: ["Yes, stays low", "No, spikes above"], feedKey: "ETH_GAS", rawThreshold: BigInt(Math.round(low*1e9)), optionIfAbove: 1 });
  }
  return shuffle(pool);
}

// Cached providers — reused across requests
let _arcProvider: ethers.JsonRpcProvider | null = null;
let _ethProvider: ethers.JsonRpcProvider | null = null;
function getArcProvider() { if (!_arcProvider) _arcProvider = new ethers.JsonRpcProvider(ARC_RPC); return _arcProvider; }
function getCMEthProvider() { if (!_ethProvider) _ethProvider = new ethers.JsonRpcProvider(ETH_RPC); return _ethProvider; }

// ── POST /api/create-markets ──────────────────────────────────────────────────
export async function POST() {
  if (!DEPLOYER_KEY || !CONTRACT_ADDRESS) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  return withDeployerLock(async () => {
    try {
      const arcProvider  = getArcProvider();
      const ethProvider  = getCMEthProvider();
      const wallet       = new ethers.Wallet(DEPLOYER_KEY, arcProvider);
      const iface        = new ethers.Interface(CONTRACT_ABI);
      const readContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, arcProvider);

      // Fetch feeds in parallel (8s timeout)
      const feedKeys = Object.keys(FEEDS);
      const feedTimeout = new Promise<null[]>((r) => setTimeout(() => r(feedKeys.map(() => null)), 8000));
      const feedResults = await Promise.race([
        Promise.all(feedKeys.map((k) => readFeed(ethProvider, k).then((v) => [k, v] as [string, FeedData | null]))),
        feedTimeout.then(() => feedKeys.map((k) => [k, null] as [string, null])),
      ]);

      const feeds: Record<string, FeedData | null> = {};
      for (const [k, v] of feedResults) feeds[k] = v;

      const prices: Record<string, number> = {};
      for (const [k, v] of Object.entries(feeds)) if (v) prices[k] = v.value;

      const dMin = DURATION_SECS / 60;

      // Try AI generation first, fall back to templates
      let markets: MarketSpec[] = [];
      if (ZG_API_KEY) {
        try {
          console.log("[create-markets] Using 0G Compute AI generation...");
          markets = await generateWithAI(prices, dMin);
          console.log(`[create-markets] AI generated ${markets.length} markets`);
        } catch (err: any) {
          console.warn("[create-markets] AI generation failed, using fallback:", err.message);
        }
      }

      if (markets.length < 2) {
        console.log("[create-markets] Using deterministic fallback pool");
        markets = fallbackPool(feeds, dMin).slice(0, 2);
      }

      const startId = Number(await readContract.marketCount());
      const created: number[] = [];

      // Get current nonce once and increment manually to avoid race conditions
      let nonce = await wallet.getNonce("pending");

      for (let i = 0; i < markets.length; i++) {
        const m        = markets[i];
        const marketId = startId + i;
        const expiry   = Math.floor(Date.now() / 1000) + DURATION_SECS;
        const aiTag    = ZG_API_KEY ? "0g://ai-llama70b" : "0g://mock";
        const hash     = `${aiTag}-${m.feedKey.toLowerCase().replace("/","-")}-${Date.now()}`;

        const data = iface.encodeFunctionData("createMarket", [m.question, m.options, expiry, hash]);
        const tx   = await wallet.sendTransaction({ to: CONTRACT_ADDRESS, data, nonce: nonce++ });
        await tx.wait();
        created.push(marketId);
        console.log(`[create-markets] Market ${marketId}: ${m.question}`);
      }

      return NextResponse.json({ created, count: created.length, aiGenerated: !!ZG_API_KEY });
    } catch (err: any) {
      console.error("[create-markets]", err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  });
}
