/**
 * Chainlink CRE Resolution Workflow
 *
 * This TypeScript workflow is designed to be compiled and deployed via the
 * Chainlink CRE CLI to a Decentralised Oracle Network (DON).
 *
 * What it does:
 *  1. Reads all unresolved, expired markets from the PredictionMarket contract
 *  2. For each market, downloads its metadata from 0G Storage
 *  3. Fetches the real-world outcome from the API specified in the metadata
 *  4. Evaluates the win condition
 *  5. Calls resolveMarket(marketId, winningOption) on the contract
 *
 * Because this runs on a Chainlink DON (fault-tolerant decentralized network),
 * no single party controls market resolution. The outcome is fully trustless.
 *
 * CRE Workflow SDK docs: https://docs.chain.link/cre
 */

// ─── CRE SDK types (simplified for compilation without the full SDK) ──────────
// In production, import from "@chainlink/workflow-sdk"
export interface WorkflowContext {
  trigger: { type: "cron"; schedule: string };
}

export interface WorkflowResult {
  success: boolean;
  resolvedMarkets: number[];
  errors: string[];
}

// ─── Workflow definition ───────────────────────────────────────────────────────

/**
 * CRE Workflow entry point.
 * Triggered every 5 minutes by the DON cron trigger.
 */
export async function workflow(ctx: WorkflowContext): Promise<WorkflowResult> {
  const { resolveExpiredMarkets } = await import("./resolver");
  return resolveExpiredMarkets();
}

/**
 * CRE Workflow configuration.
 * This object is read by the CRE CLI when compiling/deploying.
 */
export const workflowConfig = {
  name:        "alphamarket-resolution",
  description: "Resolves expired AlphaMarket prediction markets using public APIs",
  trigger: {
    type:     "cron",
    schedule: "*/5 * * * *", // every 5 minutes
  },
  capabilities: [
    "http",       // Fetch real-world data from public APIs
    "evm-write",  // Call resolveMarket() on Arc
  ],
  secrets: [
    "RESOLVER_PRIVATE_KEY",
    "CONTRACT_ADDRESS",
    "ARC_RPC_URL",
  ],
};
