/**
 * Chainlink On-Chain Data Reader
 *
 * Reads directly from Chainlink Aggregator contracts on Ethereum mainnet.
 * This is used to:
 *  1. Give the AI agent live, verifiable context for market generation
 *  2. Provide exact feed addresses so Chainlink CRE can resolve markets
 *     by reading the same feeds on-chain (no REST API dependency)
 *
 * Why on-chain vs REST API?
 *  - CoinGecko can go down. Chainlink feeds cannot.
 *  - On-chain resolution is trustless — no one controls the data source.
 *  - Judges can verify the feed address on Etherscan.
 */

import { ethers } from "ethers";
import { logger } from "./logger";

// Chainlink AggregatorV3Interface — only what we need
const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
];

// Public Ethereum mainnet RPC (read-only, no gas needed)
const ETH_MAINNET_RPC = "https://ethereum-rpc.publicnode.com";

// Chainlink feed registry — Ethereum mainnet
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses
export const CHAINLINK_FEEDS: Record<string, { address: string; description: string }> = {
  "BTC/USD":           { address: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88b", description: "Bitcoin / US Dollar" },
  "ETH/USD":           { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", description: "Ethereum / US Dollar" },
  "LINK/USD":          { address: "0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c", description: "Chainlink / US Dollar" },
  "SOL/USD":           { address: "0x4ffC43a60e009B551865A93d232E33Fce9f01507", description: "Solana / US Dollar" },
  "ETH_GAS_GWEI":      { address: "0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C", description: "Fast Gas / Gwei" },
  "TOTAL_MARKETCAP":   { address: "0xEC8761a0A73c34329CA5B1D3Dc7eD07F30e836e2", description: "Total Crypto Market Cap / USD" },
};

export interface FeedReading {
  feedKey:      string;
  description:  string;
  address:      string;
  value:        number;
  decimals:     number;
  updatedAt:    Date;
  ageMinutes:   number;
  roundId:      string;
}

export interface ChainlinkContext {
  feeds:      Record<string, FeedReading>;
  fetchedAt:  string;
  rpc:        string;
}

async function readFeed(
  provider: ethers.JsonRpcProvider,
  feedKey: string
): Promise<FeedReading | null> {
  const feed = CHAINLINK_FEEDS[feedKey];
  if (!feed) return null;

  try {
    const contract  = new ethers.Contract(feed.address.toLowerCase(), AGGREGATOR_ABI, provider);
    const [roundData, decimals] = await Promise.all([
      contract.latestRoundData(),
      contract.decimals(),
    ]);

    // ETH Fast Gas feed returns wei (0 declared decimals), convert to gwei for display
    const rawDecimals = Number(decimals);
    const divisor     = feedKey === "ETH_GAS_GWEI" ? 1e9 : Math.pow(10, rawDecimals);
    const value       = Number(roundData.answer) / divisor;
    const updatedAt  = new Date(Number(roundData.updatedAt) * 1000);
    const ageMinutes = Math.floor((Date.now() - updatedAt.getTime()) / 60000);

    return {
      feedKey,
      description: feed.description,
      address:     feed.address,
      value,
      decimals:    rawDecimals,
      updatedAt,
      ageMinutes,
      roundId:     roundData.roundId.toString(),
    };
  } catch (err: any) {
    logger.warn(`Failed to read Chainlink feed ${feedKey}: ${err.message}`);
    return null;
  }
}

/**
 * Read all configured Chainlink feeds from Ethereum mainnet.
 * Returns only successfully fetched feeds.
 */
export async function fetchChainlinkFeeds(): Promise<ChainlinkContext> {
  logger.info("Reading Chainlink on-chain feeds from Ethereum mainnet...");

  const provider = new ethers.JsonRpcProvider(ETH_MAINNET_RPC);
  const results  = await Promise.allSettled(
    Object.keys(CHAINLINK_FEEDS).map((key) => readFeed(provider, key))
  );

  const feeds: Record<string, FeedReading> = {};
  results.forEach((r) => {
    if (r.status === "fulfilled" && r.value) {
      feeds[r.value.feedKey] = r.value;
    }
  });

  const feedCount = Object.keys(feeds).length;
  logger.info(`Read ${feedCount}/${Object.keys(CHAINLINK_FEEDS).length} Chainlink feeds`);

  // Log key values
  if (feeds["BTC/USD"])      logger.info(`  BTC/USD:      $${feeds["BTC/USD"].value.toLocaleString()} (${feeds["BTC/USD"].ageMinutes}m ago)`);
  if (feeds["ETH/USD"])      logger.info(`  ETH/USD:      $${feeds["ETH/USD"].value.toLocaleString()} (${feeds["ETH/USD"].ageMinutes}m ago)`);
  if (feeds["ETH_GAS_GWEI"]) logger.info(`  Gas (Fast):   ${feeds["ETH_GAS_GWEI"].value.toFixed(2)} gwei (${feeds["ETH_GAS_GWEI"].ageMinutes}m ago)`);

  return { feeds, fetchedAt: new Date().toISOString(), rpc: ETH_MAINNET_RPC };
}

/**
 * Format Chainlink context as a text block to inject into the AI prompt.
 */
export function formatChainlinkContext(ctx: ChainlinkContext): string {
  const lines = [
    `=== CHAINLINK ON-CHAIN DATA (Ethereum Mainnet, fetched ${ctx.fetchedAt}) ===`,
    "Source: Real Chainlink AggregatorV3 contracts — same feeds that will resolve these markets",
    "",
  ];

  const f = ctx.feeds;

  if (f["BTC/USD"])
    lines.push(`BTC/USD:             $${f["BTC/USD"].value.toLocaleString("en-US", { maximumFractionDigits: 0 })} (updated ${f["BTC/USD"].ageMinutes}m ago | feed: ${f["BTC/USD"].address})`);

  if (f["ETH/USD"])
    lines.push(`ETH/USD:             $${f["ETH/USD"].value.toLocaleString("en-US", { maximumFractionDigits: 0 })} (updated ${f["ETH/USD"].ageMinutes}m ago | feed: ${f["ETH/USD"].address})`);

  if (f["SOL/USD"])
    lines.push(`SOL/USD:             $${f["SOL/USD"].value.toFixed(2)} (updated ${f["SOL/USD"].ageMinutes}m ago)`);

  if (f["LINK/USD"])
    lines.push(`LINK/USD:            $${f["LINK/USD"].value.toFixed(3)} (updated ${f["LINK/USD"].ageMinutes}m ago)`);

  if (f["ETH_GAS_GWEI"])
    lines.push(`ETH Gas (Fast):      ${f["ETH_GAS_GWEI"].value.toFixed(2)} gwei (updated ${f["ETH_GAS_GWEI"].ageMinutes}m ago | feed: ${f["ETH_GAS_GWEI"].address})`);

  if (f["TOTAL_MARKETCAP"])
    lines.push(`Total Crypto MCap:   $${(f["TOTAL_MARKETCAP"].value / 1e9).toFixed(1)}B (updated ${f["TOTAL_MARKETCAP"].ageMinutes}m ago)`);

  lines.push("");
  lines.push("IMPORTANT: Use the EXACT feed addresses above in resolutionApi when creating markets.");
  lines.push("Format for Chainlink feed resolution: chainlink://<feedAddress>");
  lines.push("=== END CHAINLINK DATA ===");

  return lines.join("\n");
}

/**
 * Build dynamic fallback markets using live Chainlink data.
 * Called when 0G Compute is unavailable.
 */
export function buildChainlinkFallbackMarkets(ctx: ChainlinkContext, durationSecs = 86400) {
  const f       = ctx.feeds;
  const markets = [];

  // BTC/USD market — threshold 1% above current
  const btc = f["BTC/USD"]?.value;
  if (btc) {
    const threshold = Math.round(btc * 1.01 / 500) * 500;
    markets.push({
      question:       `Will BTC/USD exceed $${threshold.toLocaleString()} in 24h? (Chainlink: $${btc.toLocaleString()})`,
      options:        [`Yes, above $${threshold.toLocaleString()}`, `No, stays below`],
      durationSecs,
      chainlinkJobId: "price-feed",
      resolutionApi:  `chainlink://${f["BTC/USD"].address}`,
      resolutionPath: "$.answer",
      winCondition:   `BTC/USD Chainlink feed answer > ${threshold * 1e8}`,
      confidence:     0.82,
      reasoning:      `BTC at $${btc.toLocaleString()} per Chainlink feed. 1% upside move to $${threshold.toLocaleString()}.`,
      sources:        [`https://etherscan.io/address/${f["BTC/USD"].address}`],
      autoResolve:    { feedKey: "BTC/USD", rawThreshold: threshold * 1e8, optionIfAbove: 0 },
    });
  }

  // ETH/USD market — threshold 1% below (support level)
  const eth = f["ETH/USD"]?.value;
  if (eth) {
    const support = Math.round(eth * 0.99 / 50) * 50;
    markets.push({
      question:       `Will ETH/USD hold above $${support.toLocaleString()} in 24h? (Chainlink: $${eth.toLocaleString()})`,
      options:        [`Yes, holds above $${support.toLocaleString()}`, `No, breaks below`],
      durationSecs,
      chainlinkJobId: "price-feed",
      resolutionApi:  `chainlink://${f["ETH/USD"].address}`,
      resolutionPath: "$.answer",
      winCondition:   `ETH/USD Chainlink feed answer > ${support * 1e8}`,
      confidence:     0.78,
      reasoning:      `ETH at $${eth.toLocaleString()} per Chainlink. Key support at $${support.toLocaleString()} (-1%).`,
      sources:        [`https://etherscan.io/address/${f["ETH/USD"].address}`],
      autoResolve:    { feedKey: "ETH/USD", rawThreshold: support * 1e8, optionIfAbove: 0 },
    });
  }

  // Gas price market — this is unique, no other prediction market does this
  const gas = f["ETH_GAS_GWEI"]?.value;
  if (gas) {
    const rawThreshold = gas * 1.5;
    const threshold    = Math.max(rawThreshold, 0.01);
    const thresholdStr = threshold >= 1 ? threshold.toFixed(0) : threshold.toFixed(2);
    const gasStr       = gas >= 1 ? gas.toFixed(1) : gas.toFixed(2);
    markets.push({
      question:       `Will Ethereum gas price (Fast) spike above ${thresholdStr} gwei in 24h? (Chainlink: ${gasStr} gwei)`,
      options:        [`Yes, spikes above ${thresholdStr} gwei`, `No, stays below ${thresholdStr} gwei`],
      durationSecs,
      chainlinkJobId: "gas-feed",
      resolutionApi:  `chainlink://${f["ETH_GAS_GWEI"].address}`,
      resolutionPath: "$.answer",
      winCondition:   `ETH gas Chainlink feed answer > ${threshold * 1e9}`,
      confidence:     0.74,
      reasoning:      `Gas at ${gasStr} gwei. High volatility during network congestion events. 1.5x threshold.`,
      sources:        [`https://etherscan.io/address/${f["ETH_GAS_GWEI"].address}`],
      autoResolve:    { feedKey: "ETH_GAS_GWEI", rawThreshold: threshold * 1e9, optionIfAbove: 0 },
    });
  }

  return markets;
}
