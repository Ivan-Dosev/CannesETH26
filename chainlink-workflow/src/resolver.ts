/**
 * Core resolution logic — shared between the CRE workflow and the local watcher.
 *
 * Resolution priority:
 *  1. chainlink://0x<address> — read directly from Chainlink AggregatorV3 on-chain (trustless)
 *  2. https://... — fetch from REST API (fallback)
 */

import { ethers } from "ethers";
import axios from "axios";
import { JSONPath } from "jsonpath-plus";
import * as dotenv from "dotenv";
import { logger } from "./logger";

// Chainlink AggregatorV3 — read latestRoundData
const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

const ETH_MAINNET_RPC = process.env.ETH_MAINNET_RPC ?? "https://ethereum-rpc.publicnode.com";

/**
 * Read a Chainlink feed and return the human-readable value.
 * resolutionApi format: "chainlink://0x<feedAddress>"
 */
async function readChainlinkFeed(resolutionApi: string): Promise<number> {
  const feedAddress = resolutionApi.replace("chainlink://", "");
  const provider    = new ethers.JsonRpcProvider(ETH_MAINNET_RPC);
  const feed        = new ethers.Contract(feedAddress, AGGREGATOR_ABI, provider);

  const [roundData, decimals] = await Promise.all([
    feed.latestRoundData(),
    feed.decimals(),
  ]);

  const value = Number(roundData.answer) / Math.pow(10, Number(decimals));
  logger.info(`Chainlink feed ${feedAddress}: ${value} (raw: ${roundData.answer})`);
  return value;
}

dotenv.config();

const CONTRACT_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
  "function resolveMarket(uint256 marketId, uint256 winningOption)",
  "event MarketResolved(uint256 indexed marketId, uint256 winningOption)",
];

interface MarketMetadata {
  chainlinkJobId: string;
  resolutionApi:  string;
  resolutionPath: string;
  winCondition:   string;
  options:        string[];
}

interface MarketView {
  question:    string;
  options:     string[];
  expiry:      bigint;
  totalPool:   bigint;
  resolved:    boolean;
  cancelled:   boolean;
  storageHash: string;
}

export interface WorkflowResult {
  success:          boolean;
  resolvedMarkets:  number[];
  errors:           string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Download market metadata from 0G Storage.
 * Falls back to parsing the storageHash as a direct URL for demo purposes.
 */
async function fetchMetadata(storageHash: string): Promise<MarketMetadata | null> {
  try {
    // For demo: if storageHash looks like a URL, fetch it directly
    if (storageHash.startsWith("http")) {
      const res = await axios.get(storageHash, { timeout: 5000 });
      return res.data as MarketMetadata;
    }

    // Real 0G Storage download
    const rootHash  = storageHash.replace("0g://", "").replace("0g://mock-", "");
    const nodeUrl   = process.env.ZG_STORAGE_NODE_URL ?? "https://storage-node.0g.ai";
    const res       = await axios.get(`${nodeUrl}/download/${rootHash}`, { timeout: 10000 });
    return res.data as MarketMetadata;
  } catch (err: any) {
    logger.warn(`Could not fetch metadata for ${storageHash}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch the outcome and evaluate the win condition.
 * Supports chainlink:// (on-chain) and https:// (REST API).
 * Returns the index of the winning option (0-based).
 */
async function evaluateWinCondition(
  metadata: MarketMetadata,
  options:  string[]
): Promise<number> {
  let value: number | string;

  if (metadata.resolutionApi.startsWith("chainlink://")) {
    // ── On-chain Chainlink resolution (trustless) ──────────────────────────
    value = await readChainlinkFeed(metadata.resolutionApi);
    logger.info(`Resolved via Chainlink on-chain: ${value}`);
  } else {
    // ── REST API fallback ──────────────────────────────────────────────────
    const res = await axios.get(metadata.resolutionApi, { timeout: 10000 });
    value     = JSONPath({ path: metadata.resolutionPath, json: res.data, wrap: false });
  }

  logger.info(`API value: ${value} | Win condition: ${metadata.winCondition}`);

  // Parse the win condition: "BTC/USD price is above 70000"
  const condition = metadata.winCondition.toLowerCase();
  const numValue  = parseFloat(String(value));

  const aboveMatch = condition.match(/above\s+([\d.]+)/);
  const belowMatch = condition.match(/below\s+([\d.]+)/);
  const equalMatch = condition.match(/equals?\s+["']?([^"']+)["']?/);

  if (aboveMatch) {
    const threshold = parseFloat(aboveMatch[1]);
    return numValue > threshold ? 0 : 1;
  }

  if (belowMatch) {
    const threshold = parseFloat(belowMatch[1]);
    return numValue < threshold ? 0 : 1;
  }

  if (equalMatch) {
    const expected = equalMatch[1].trim().toLowerCase();
    const actual   = String(value).trim().toLowerCase();
    return actual === expected ? 0 : 1;
  }

  // Sports / categorical: try to find which option matches the string value
  const strValue = String(value).toLowerCase();
  for (let i = 0; i < options.length; i++) {
    if (strValue.includes(options[i].toLowerCase())) return i;
  }

  logger.warn(`Could not evaluate win condition — defaulting to option 1 (No/Lose)`);
  return 1;
}

// ── Main resolution loop ───────────────────────────────────────────────────────

export async function resolveExpiredMarkets(): Promise<WorkflowResult> {
  const result: WorkflowResult = { success: true, resolvedMarkets: [], errors: [] };

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL);
  const wallet   = new ethers.Wallet(process.env.RESOLVER_PRIVATE_KEY!, provider);
  const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS!, CONTRACT_ABI, wallet);

  const marketCount = Number(await contract.marketCount());
  logger.info(`Checking ${marketCount} markets for resolution...`);

  const now = Math.floor(Date.now() / 1000);

  for (let id = 0; id < marketCount; id++) {
    try {
      const market: MarketView = await contract.getMarket(id);

      // Skip already resolved, cancelled, or not yet expired
      if (market.resolved || market.cancelled)         continue;
      if (Number(market.expiry) > now)                 continue;

      logger.info(`Market ${id} expired: "${market.question}"`);

      // Fetch AI metadata from 0G Storage
      const metadata = await fetchMetadata(market.storageHash);

      let winningOption: number;

      if (metadata) {
        winningOption = await evaluateWinCondition(metadata, market.options);
      } else {
        // Fallback: use hardcoded job handlers based on question content
        winningOption = await evaluateByQuestion(market.question);
      }

      logger.info(`Market ${id}: winning option = ${winningOption} (${market.options[winningOption]})`);

      // Call resolveMarket on-chain
      const tx = await contract.resolveMarket(id, winningOption);
      await tx.wait();

      logger.info(`✅ Market ${id} resolved. TX: ${tx.hash}`);
      result.resolvedMarkets.push(id);
    } catch (err: any) {
      const msg = `Failed to resolve market ${id}: ${err.message}`;
      logger.error(msg);
      result.errors.push(msg);
    }
  }

  logger.info(`Resolution cycle complete. Resolved: ${result.resolvedMarkets.length}`);
  return result;
}

/**
 * Fallback evaluator when 0G metadata is unavailable.
 * Uses the market question text to infer the API to call.
 */
async function evaluateByQuestion(question: string): Promise<number> {
  const q = question.toLowerCase();

  if (q.includes("bitcoin") || q.includes("btc")) {
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { timeout: 5000 }
    );
    const price = res.data.bitcoin.usd;
    const match = q.match(/\$([\d,]+)/);
    if (match) {
      const threshold = parseFloat(match[1].replace(",", ""));
      return price > threshold ? 0 : 1;
    }
  }

  if (q.includes("ethereum") || q.includes("eth")) {
    const res = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { timeout: 5000 }
    );
    const price = res.data.ethereum.usd;
    const match = q.match(/\$([\d,]+)/);
    if (match) {
      const threshold = parseFloat(match[1].replace(",", ""));
      return price > threshold ? 0 : 1;
    }
  }

  logger.warn("Could not auto-evaluate question — defaulting to 1");
  return 1;
}
