import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const ZG_API_KEY  = process.env.ZG_API_KEY ?? "";
const ZG_ENDPOINT = process.env.ZG_COMPUTE_ENDPOINT ?? "https://api.0g.ai/v1";

export interface BotStrategy {
  filterType:         "price" | "gas" | "all";
  assets:             string[];   // ["ETH/USD","BTC/USD",...] or ["all"]
  triggerSecondsLeft: number;     // place bet when this many seconds remain
  betAmount:          number;     // USDC per bet
  maxBetsTotal:       number;     // safety cap
  description:        string;     // human-readable summary
}

// Keyword fallback — no AI key needed
function parseWithKeywords(instruction: string): BotStrategy {
  const text = instruction.toLowerCase();

  // Assets
  const assets: string[] = [];
  if (/eth\b/.test(text))  assets.push("ETH/USD");
  if (/btc|bitcoin/.test(text)) assets.push("BTC/USD");
  if (/sol\b|solana/.test(text)) assets.push("SOL/USD");
  if (/avax|avalanche/.test(text)) assets.push("AVAX/USD");
  if (/gas/.test(text))    assets.push("ETH_GAS");
  if (assets.length === 0) assets.push("all");

  // Trigger
  const secMatch = text.match(/(\d+)\s*sec/);
  const triggerSecondsLeft = secMatch ? parseInt(secMatch[1]) : 5;

  // Amount
  const amtMatch = text.match(/\$?([\d.]+)\s*usdc?/);
  const betAmount = amtMatch ? parseFloat(amtMatch[1]) : 0.1;

  // Max bets
  const maxMatch = text.match(/max\s*(\d+)\s*bet/);
  const maxBetsTotal = maxMatch ? parseInt(maxMatch[1]) : 10;

  const filterType = assets[0] === "ETH_GAS" ? "gas" : assets[0] === "all" ? "all" : "price";
  const assetLabel = assets[0] === "all" ? "all markets" : assets.join(", ");
  const description = `Auto-bet $${betAmount} USDC on ${assetLabel} when ${triggerSecondsLeft}s remain and Chainlink price favours an outcome`;

  return { filterType, assets, triggerSecondsLeft, betAmount, maxBetsTotal, description };
}

export async function POST(req: NextRequest) {
  const { instruction } = await req.json();
  if (!instruction) {
    return NextResponse.json({ error: "Missing instruction" }, { status: 400 });
  }

  // Attempt AI parsing via 0G Compute
  if (ZG_API_KEY) {
    try {
      const client = new OpenAI({ baseURL: ZG_ENDPOINT, apiKey: ZG_API_KEY });

      const systemPrompt = `You are a trading bot strategy parser for a DeFi prediction market platform.
Markets are binary (Yes/No) and settle based on live Chainlink oracle prices for ETH/USD, SOL/USD, BTC/USD, AVAX/USD, or ETH gas.
Parse the user's natural-language trading instruction into a structured JSON strategy.
Available assets: ETH/USD, SOL/USD, BTC/USD, AVAX/USD, ETH_GAS`;

      const userPrompt = `Parse this trading instruction into a bot strategy:
"${instruction}"

Respond ONLY with valid JSON:
{
  "filterType": "price" | "gas" | "all",
  "assets": ["ETH/USD", "BTC/USD"] (or ["all"] for any market),
  "triggerSecondsLeft": <number, when to fire — default 5>,
  "betAmount": <number USDC — default 0.1>,
  "maxBetsTotal": <number safety cap — default 10>,
  "description": "<one sentence human-readable summary of what the bot will do>"
}`;

      const res = await client.chat.completions.create({
        model:           "neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8",
        messages:        [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        temperature:     0.2,
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
      if (parsed.filterType && parsed.assets) {
        return NextResponse.json({ strategy: parsed, source: "0g-ai" });
      }
    } catch (e: any) {
      console.warn("[parse-strategy] AI failed, using keywords:", e.message);
    }
  }

  // Fallback to keyword parser
  const strategy = parseWithKeywords(instruction);
  return NextResponse.json({ strategy, source: "keyword-parser" });
}
