/**
 * Local watcher — polls for expired markets and resolves them.
 * Used as a fallback when CRE deployment is pending.
 * In production, replace this with the deployed CRE workflow.
 */

import { resolveExpiredMarkets } from "./resolver";
import { logger } from "./logger";
import * as dotenv from "dotenv";

dotenv.config();

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS ?? "60000");

async function main() {
  logger.info(`Chainlink resolver watcher starting (poll every ${POLL_INTERVAL / 1000}s)`);

  const run = async () => {
    try {
      await resolveExpiredMarkets();
    } catch (err: any) {
      logger.error(`Resolution cycle failed: ${err.message}`);
    }
  };

  await run();
  setInterval(run, POLL_INTERVAL);
}

main();
