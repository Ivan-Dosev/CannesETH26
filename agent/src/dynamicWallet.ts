/**
 * Dynamic server wallet integration.
 *
 * The AI agent uses a Dynamic server wallet as its on-chain identity.
 * This means:
 *  - The agent has a proper managed wallet (not a raw private key in a .env)
 *  - Dynamic handles key custody, signing policies, and spend limits
 *  - The wallet address is registered as `aiAgent` in the smart contract
 *
 * Dynamic Node SDK docs: https://www.dynamic.xyz/docs/node/quickstart
 */

import axios from "axios";
import { ethers } from "ethers";
import { config } from "./config";
import { logger } from "./logger";

const DYNAMIC_API_BASE = "https://app.dynamic.xyz/api/v0";

interface DynamicWallet {
  id:         string;
  address:    string;
  chain:      string;
  walletType: string;
}

/**
 * Get or create the AI agent's server wallet via Dynamic.
 * In production this wallet address is stored in the smart contract as `aiAgent`.
 */
export async function getOrCreateAgentWallet(): Promise<DynamicWallet> {
  const headers = {
    Authorization: `Bearer ${config.dynamic.apiKey}`,
    "Content-Type": "application/json",
  };

  // List existing server wallets
  const listRes = await axios.get(
    `${DYNAMIC_API_BASE}/environments/${config.dynamic.envId}/serverWallets`,
    { headers }
  );

  const wallets: DynamicWallet[] = listRes.data.serverWallets ?? [];
  const existing = wallets.find((w) => w.chain === "evm");

  if (existing) {
    logger.info(`Using existing Dynamic server wallet: ${existing.address}`);
    return existing;
  }

  // Create a new server wallet
  const createRes = await axios.post(
    `${DYNAMIC_API_BASE}/environments/${config.dynamic.envId}/serverWallets`,
    { chain: "evm" },
    { headers }
  );

  const created: DynamicWallet = createRes.data;
  logger.info(`Created new Dynamic server wallet: ${created.address}`);
  return created;
}

/**
 * Sign and broadcast a transaction using Dynamic's server wallet signing API.
 * Dynamic manages the private key — we never handle it directly.
 */
export async function sendTransaction(
  walletId: string,
  to: string,
  data: string,
  provider: ethers.JsonRpcProvider
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${config.dynamic.apiKey}`,
    "Content-Type": "application/json",
  };

  const feeData = await provider.getFeeData();
  const nonce   = await provider.getTransactionCount(
    (await getOrCreateAgentWallet()).address
  );

  const txPayload = {
    to,
    data,
    chainId: config.contract.chainId,
    nonce,
    maxFeePerGas:         feeData.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
    gasLimit: "500000",
  };

  const res = await axios.post(
    `${DYNAMIC_API_BASE}/environments/${config.dynamic.envId}/serverWallets/${walletId}/transactions`,
    { transaction: txPayload },
    { headers }
  );

  const txHash: string = res.data.txHash;
  logger.info(`Dynamic transaction sent: ${txHash}`);
  return txHash;
}
