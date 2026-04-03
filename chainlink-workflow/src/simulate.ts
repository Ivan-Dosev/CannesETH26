/**
 * Local simulation script — run this to demo the workflow before CRE deployment.
 *
 * Usage: npx ts-node src/simulate.ts
 *
 * This simulates a single CRE workflow execution cycle and prints what
 * would happen when deployed to the Chainlink DON.
 */

import { resolveExpiredMarkets } from "./resolver";
import { logger } from "./logger";

async function simulate() {
  logger.info("═══════════════════════════════════════════════════");
  logger.info("  Chainlink CRE Workflow — LOCAL SIMULATION");
  logger.info("═══════════════════════════════════════════════════");
  logger.info("This simulates one execution cycle of the workflow.");
  logger.info("In production this runs on a Chainlink DON every 5 minutes.");
  logger.info("");

  const result = await resolveExpiredMarkets();

  logger.info("");
  logger.info("═══════════════════════════════════════════════════");
  logger.info(`Simulation complete`);
  logger.info(`Resolved markets: ${result.resolvedMarkets.join(", ") || "none"}`);
  if (result.errors.length > 0) {
    logger.warn(`Errors: ${result.errors.join("; ")}`);
  }
  logger.info("═══════════════════════════════════════════════════");
}

simulate().catch(console.error);
