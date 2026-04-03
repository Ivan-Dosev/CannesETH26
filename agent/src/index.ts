/**
 * AlphaMarket AI Agent
 *
 * This agent runs on a cron schedule and autonomously:
 *  1. Calls 0G Compute to generate verifiable prediction market ideas
 *  2. Uploads full AI metadata to 0G Storage (provenance)
 *  3. Creates markets on-chain via its Dynamic server wallet
 *     (falls back to direct ethers signer when Dynamic is not yet configured)
 *  4. Auto-resolves each market at expiry by reading the live Chainlink feed
 */

import { ethers } from "ethers";
import { CronJob } from "cron";
import { config } from "./config";
import { logger } from "./logger";
import { generateMarkets } from "./marketGenerator";
import { uploadMarketMetadata, MarketMetadata } from "./zeroGStorage";
import { getOrCreateAgentWallet, sendTransaction } from "./dynamicWallet";
import { fetchChainlinkFeeds, CHAINLINK_FEEDS } from "./chainlinkFeeds";

const CONTRACT_ABI = [
  "function createMarket(string question, string[] options, uint256 expiry, string storageHash) returns (uint256)",
  "function marketCount() view returns (uint256)",
  "function resolveMarket(uint256 marketId, uint256 winningOption)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
  "event MarketCreated(uint256 indexed marketId, string question, string[] options, uint256 expiry, string storageHash)",
];

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

const ETH_MAINNET_RPC = "https://ethereum-rpc.publicnode.com";

/**
 * Returns a signer. Prefers Dynamic server wallet; falls back to deployer key.
 */
async function getSigner(provider: ethers.JsonRpcProvider): Promise<{
  address: string;
  send: (to: string, data: string) => Promise<string>;
}> {
  if (config.dynamic.apiKey && config.dynamic.envId) {
    try {
      const wallet = await getOrCreateAgentWallet();
      return {
        address: wallet.address,
        send: (to, data) => sendTransaction(wallet.id, to, data, provider),
      };
    } catch (err: any) {
      logger.warn(`Dynamic wallet unavailable, falling back to deployer key: ${err.message}`);
    }
  }

  if (!config.contract.privateKey) throw new Error("No signer available — set DEPLOYER_PRIVATE_KEY or DYNAMIC_API_KEY");
  const wallet = new ethers.Wallet(config.contract.privateKey, provider);
  logger.info(`Using deployer wallet as agent signer: ${wallet.address}`);
  return {
    address: wallet.address,
    send: async (to, data) => {
      const tx = await wallet.sendTransaction({ to, data });
      await tx.wait();
      return tx.hash;
    },
  };
}

/**
 * Read the raw feed answer from a Chainlink aggregator on Ethereum mainnet.
 */
async function readRawFeedAnswer(feedKey: string): Promise<bigint | null> {
  const feed = CHAINLINK_FEEDS[feedKey];
  if (!feed) return null;
  try {
    const provider  = new ethers.JsonRpcProvider(ETH_MAINNET_RPC);
    const contract  = new ethers.Contract(feed.address.toLowerCase(), AGGREGATOR_ABI, provider);
    const roundData = await contract.latestRoundData();
    return BigInt(roundData.answer);
  } catch (err: any) {
    logger.warn(`Auto-resolve: failed to read feed ${feedKey}: ${err.message}`);
    return null;
  }
}

/**
 * Resolve a single market by reading its Chainlink feed and comparing to threshold.
 */
async function autoResolveMarket(
  marketId: number,
  feedKey: string,
  rawThreshold: number,
  optionIfAbove: number,
  signer: { send: (to: string, data: string) => Promise<string> }
) {
  logger.info(`Auto-resolving market ${marketId} (feed: ${feedKey}, threshold: ${rawThreshold})...`);

  const answer = await readRawFeedAnswer(feedKey);
  if (answer === null) {
    logger.error(`Auto-resolve market ${marketId}: could not read feed — skipping`);
    return;
  }

  const winningOption = answer > BigInt(Math.floor(rawThreshold)) ? optionIfAbove : 1 - optionIfAbove;
  logger.info(`  Feed answer: ${answer}  |  threshold: ${rawThreshold}  |  winner: option ${winningOption}`);

  try {
    const iface    = new ethers.Interface(CONTRACT_ABI);
    const calldata = iface.encodeFunctionData("resolveMarket", [marketId, winningOption]);
    const txHash   = await signer.send(config.contract.address, calldata);
    logger.info(`✅ Market ${marketId} auto-resolved (option ${winningOption}). TX: ${txHash}`);
  } catch (err: any) {
    logger.error(`Auto-resolve market ${marketId} failed: ${err.message}`);
  }
}

async function runAgentCycle() {
  logger.info("═══════════════════════════════════════════");
  logger.info("AlphaMarket Agent — starting cycle");
  logger.info("═══════════════════════════════════════════");

  const provider = new ethers.JsonRpcProvider(config.contract.rpcUrl);
  const signer   = await getSigner(provider);
  logger.info(`Agent wallet: ${signer.address}`);

  const contract = new ethers.Contract(config.contract.address, CONTRACT_ABI, provider);
  const iface    = new ethers.Interface(CONTRACT_ABI);

  // ── 1. Generate markets via 0G Compute ──────────────────────────────────
  const generatedMarkets = await generateMarkets(3);

  if (generatedMarkets.length === 0) {
    logger.warn("No valid markets generated this cycle");
    return;
  }

  // ── 2. Upload metadata to 0G Storage + create on-chain ──────────────────
  for (const market of generatedMarkets) {
    try {
      logger.info(`Processing: "${market.question}"`);

      // Read next market ID before creating
      const marketId = Number(await contract.marketCount());
      const expiry   = Math.floor(Date.now() / 1000) + market.durationSecs;

      const metadata: MarketMetadata = {
        version:        "1",
        generatedAt:    new Date().toISOString(),
        modelId:        "neuralmagic/Meta-Llama-3.1-70B-Instruct-FP8",
        question:       market.question,
        options:        market.options,
        expiry,
        chainlinkJobId: market.chainlinkJobId,
        resolutionApi:  market.resolutionApi,
        resolutionPath: market.resolutionPath,
        confidence:     market.confidence,
        reasoning:      market.reasoning,
        sources:        market.sources,
      };

      const storageHash = await uploadMarketMetadata(metadata);
      logger.info(`0G Storage hash: ${storageHash}`);

      const calldata = iface.encodeFunctionData("createMarket", [
        market.question,
        market.options,
        expiry,
        storageHash,
      ]);

      const txHash = await signer.send(config.contract.address, calldata);
      logger.info(`✅ Market ${marketId} created. TX: ${txHash}`);

      // ── 3. Schedule auto-resolution at expiry ──────────────────────────
      if (market.autoResolve) {
        const { feedKey, rawThreshold, optionIfAbove } = market.autoResolve;
        const delayMs = (market.durationSecs + 5) * 1000; // 5s buffer after expiry
        logger.info(`⏱  Market ${marketId} will auto-resolve in ${market.durationSecs}s (feed: ${feedKey})`);

        setTimeout(async () => {
          await autoResolveMarket(marketId, feedKey, rawThreshold, optionIfAbove, signer);
        }, delayMs);
      }

      await new Promise((r) => setTimeout(r, 2000));
    } catch (err: any) {
      logger.error(`Failed to create market "${market.question}": ${err.message}`);
    }
  }

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const total = await contract.marketCount();
  logger.info(`Total markets on contract: ${total}`);
  logger.info("Agent cycle complete");
}

async function main() {
  logger.info("AlphaMarket AI Agent starting...");
  logger.info(`Contract:  ${config.contract.address}`);
  logger.info(`Schedule:  ${config.agent.cronSchedule}`);
  logger.info(`Duration:  ${config.agent.marketDurationSecs}s per market`);

  await runAgentCycle().catch((err) => logger.error(`Startup cycle failed: ${err.message}`));

  const job = new CronJob(config.agent.cronSchedule, async () => {
    await runAgentCycle().catch((err) => logger.error(`Scheduled cycle failed: ${err.message}`));
  });

  job.start();
  logger.info("Agent is running. Press Ctrl+C to stop.");
}

main();
