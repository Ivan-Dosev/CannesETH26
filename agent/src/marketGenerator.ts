/**
 * AI Market Generator
 *
 * Data pipeline:
 *  1. Read live Chainlink on-chain feeds (BTC/USD, ETH/USD, Gas, LINK, SOL, MarketCap)
 *  2. Also fetch Fear & Greed index as sentiment signal
 *  3. Inject ALL of this into the 0G Compute LLM prompt
 *  4. LLM generates markets with EXACT Chainlink feed addresses for resolution
 *  5. Chainlink CRE workflow resolves using those same feeds — fully trustless
 */

import OpenAI from "openai";
import axios from "axios";
import { config } from "./config";
import { logger } from "./logger";
import {
  fetchChainlinkFeeds,
  formatChainlinkContext,
  buildChainlinkFallbackMarkets,
  ChainlinkContext,
} from "./chainlinkFeeds";

const client = new OpenAI({
  baseURL: config.zeroG.computeEndpoint,
  apiKey:  config.zeroG.apiKey || "placeholder",
});

export interface GeneratedMarket {
  question:       string;
  options:        string[];
  durationSecs:   number;
  chainlinkJobId: string;
  resolutionApi:  string;   // "chainlink://0x..." or fallback REST URL
  resolutionPath: string;
  winCondition:   string;
  confidence:     number;
  reasoning:      string;
  sources:        string[];
  /** Auto-resolution: read this Chainlink feed at expiry and compare to rawThreshold */
  autoResolve?: {
    feedKey:       string;  // key in CHAINLINK_FEEDS, e.g. "ETH/USD"
    rawThreshold:  number;  // raw feed answer value (before decimals division)
    optionIfAbove: number;  // option index that wins when feed > rawThreshold
  };
}

// ── Sentiment data (complements Chainlink price data) ─────────────────────────

async function fetchFearGreed(): Promise<string> {
  try {
    const res = await axios.get("https://api.alternative.me/fng/?limit=1", { timeout: 5000 });
    const d   = res.data.data[0];
    return `${d.value}/100 — ${d.value_classification}`;
  } catch {
    return "unavailable";
  }
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI agent that creates prediction markets for a decentralized platform.

You will be given LIVE data read directly from Chainlink on-chain oracle contracts.
These same Chainlink feeds will be used to RESOLVE the markets you create.

RULES:
1. Every market MUST use a Chainlink feed for resolution — format: chainlink://<feedAddress>
2. Thresholds must be derived from the CURRENT live values provided (not random numbers)
3. Set thresholds close enough to be genuinely uncertain (typically ±1-3% for prices, ±50% for gas)
4. Gas price markets are HIGHLY encouraged — they're unique and interesting
5. Options must be exactly 2: ["Yes ...", "No ..."]
6. winCondition must describe when option index 0 wins, in terms of the raw feed answer value

Valid market types (with Chainlink feeds):
- Price markets: BTC/USD, ETH/USD, SOL/USD, LINK/USD
- Gas price market: ETH Fast Gas / Gwei feed
- Total market cap market

Respond ONLY with valid JSON: { "markets": [ ...array... ] }`;

const USER_PROMPT_TEMPLATE = `{CHAINLINK_CONTEXT}

Fear & Greed Index (sentiment context): {FEAR_GREED}
Today: {DATE}

Generate {COUNT} prediction markets using the live Chainlink data above.
At least ONE market must be about Ethereum gas prices — this is uniquely interesting.

Return JSON schema for each market:
{
  "question": "string — include current value in parentheses",
  "options": ["Yes ...", "No ..."],
  "durationSecs": number (86400 for 24h),
  "chainlinkJobId": "price-feed" | "gas-feed",
  "resolutionApi": "chainlink://0x<feedAddress>",
  "resolutionPath": "$.answer",
  "winCondition": "string describing when option 0 wins with raw feed value",
  "confidence": 0.0-1.0,
  "reasoning": "string",
  "sources": ["https://etherscan.io/address/0x<feedAddress>"]
}`;

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateMarkets(count = 3): Promise<GeneratedMarket[]> {
  // Step 1: fetch live Chainlink on-chain data + sentiment
  const [chainlinkCtx, fearGreed] = await Promise.all([
    fetchChainlinkFeeds().catch((err): ChainlinkContext => {
      logger.warn(`Chainlink fetch failed: ${err.message}`);
      return { feeds: {}, fetchedAt: new Date().toISOString(), rpc: "" };
    }),
    fetchFearGreed(),
  ]);

  const chainlinkBlock = formatChainlinkContext(chainlinkCtx);
  logger.info(`Fear & Greed: ${fearGreed}`);

  // Step 2: call 0G Compute with Chainlink context injected
  if (config.zeroG.apiKey) {
    const prompt = USER_PROMPT_TEMPLATE
      .replace("{CHAINLINK_CONTEXT}", chainlinkBlock)
      .replace("{FEAR_GREED}",       fearGreed)
      .replace("{DATE}",             new Date().toISOString().split("T")[0])
      .replace("{COUNT}",            count.toString());

    try {
      logger.info("Calling 0G Compute with live Chainlink context...");

      const response = await client.chat.completions.create({
        model:           "neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user",   content: prompt },
        ],
        temperature:     0.6,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content ?? "{}";
      const parsed  = JSON.parse(content);
      const markets = (parsed.markets ?? parsed.items ?? (Array.isArray(parsed) ? parsed : [parsed])) as GeneratedMarket[];
      const valid   = markets.filter(
        (m) => m.confidence >= 0.7 && m.options?.length >= 2 && m.question?.length > 0
      );

      logger.info(`0G Compute generated ${valid.length} markets from live Chainlink data`);
      return valid;
    } catch (err: any) {
      logger.warn(`0G Compute failed, using Chainlink live fallback: ${err.message}`);
    }
  } else {
    logger.info("No ZG_API_KEY — using Chainlink live fallback markets");
  }

  // Step 3: fallback — build markets directly from Chainlink feed values
  const markets = buildChainlinkFallbackMarkets(chainlinkCtx, config.agent.marketDurationSecs);
  logger.info(`Built ${markets.length} markets from live Chainlink feeds`);
  return markets;
}
