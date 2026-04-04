/**
 * Dynamic server wallet integration using the Dynamic Node.js SDK.
 *
 * Uses two Dynamic SDK packages:
 *  - @dynamic-labs-wallet/node-evm  — DynamicEvmWalletClient for server-side wallet ops
 *  - @dynamic-labs/sdk-api          — typed REST client for environment/wallet queries
 *
 * The AI agent uses a Dynamic MPC wallet as its on-chain identity.
 * Key shares are split between this server and Dynamic — we never hold the full private key.
 */

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { WalletsApi, Configuration } from "@dynamic-labs/sdk-api";
import { config } from "./config";
import { logger } from "./logger";

// Dynamic JS SDK — typed REST client for environment-level wallet queries
const dynamicSdkConfig = new Configuration({
  basePath: "https://app.dynamic.xyz/api/v0",
  apiKey:   config.dynamic.apiKey,
});
const walletsApi = new WalletsApi(dynamicSdkConfig);

// Path where we persist the MPC wallet info (key shares + address) between agent runs
const WALLET_STORE_PATH = path.join(__dirname, "..", "dynamic-wallet.json");

interface WalletStore {
  walletId:               string;
  accountAddress:         string;
  externalServerKeyShares: any[];
}

function loadWalletStore(): WalletStore | null {
  try {
    if (fs.existsSync(WALLET_STORE_PATH)) {
      return JSON.parse(fs.readFileSync(WALLET_STORE_PATH, "utf-8"));
    }
  } catch {
    // ignore — will create fresh
  }
  return null;
}

function saveWalletStore(store: WalletStore): void {
  fs.writeFileSync(WALLET_STORE_PATH, JSON.stringify(store, null, 2), "utf-8");
}

// Singleton client — authenticated once, reused across calls
let _client: DynamicEvmWalletClient | null = null;

async function getClient(): Promise<DynamicEvmWalletClient> {
  if (_client) return _client;

  const client = new DynamicEvmWalletClient({
    environmentId:       config.dynamic.envId,
    enableMPCAccelerator: false,
  });

  // authenticateApiToken accepts the Dynamic management API key (dyn_...)
  await client.authenticateApiToken(config.dynamic.apiKey);
  logger.info("[Dynamic] Node SDK client authenticated");

  _client = client;
  return client;
}

export interface AgentWallet {
  id:      string;
  address: string;
}

/**
 * Get or create the AI agent's wallet via the Dynamic Node SDK.
 *
 * First checks local store → then queries Dynamic via WalletsApi →
 * falls back to creating a new MPC wallet account.
 */
export async function getOrCreateAgentWallet(): Promise<AgentWallet> {
  // 1. Check local store (persisted from a previous run)
  const stored = loadWalletStore();
  if (stored) {
    logger.info(`[Dynamic] Using stored wallet: ${stored.accountAddress}`);
    return { id: stored.walletId, address: stored.accountAddress };
  }

  const client = await getClient();

  // 2. Query Dynamic JS SDK for existing wallets in this environment
  try {
    const sdkWallets = await walletsApi.getWalletsByEnvironmentId({
      environmentId: config.dynamic.envId,
    });
    logger.info(`[Dynamic SDK] Found ${sdkWallets.wallets?.length ?? 0} wallets in environment`);
  } catch (e: any) {
    logger.warn(`[Dynamic SDK] WalletsApi list failed (non-fatal): ${e.message}`);
  }

  // 3. Check Node SDK for existing EVM wallets owned by this client
  const evmWallets = await client.getEvmWallets();
  if (evmWallets.length > 0) {
    const wallet = evmWallets[0];
    logger.info(`[Dynamic] Found existing Node SDK wallet: ${wallet.accountAddress}`);
    // Note: externalServerKeyShares are managed server-side for existing wallets
    saveWalletStore({
      walletId:                wallet.walletId,
      accountAddress:          wallet.accountAddress,
      externalServerKeyShares: wallet.externalServerKeyShares ?? [],
    });
    return { id: wallet.walletId, address: wallet.accountAddress };
  }

  // 4. Create a new MPC wallet account
  logger.info("[Dynamic] Creating new MPC wallet account...");
  const created = await client.createWalletAccount({
    thresholdSignatureScheme: "mpc",
  });

  logger.info(`[Dynamic] Created wallet: ${created.accountAddress}`);

  // Persist key shares locally so we can sign future transactions
  saveWalletStore({
    walletId:                created.walletId,
    accountAddress:          created.accountAddress,
    externalServerKeyShares: created.externalServerKeyShares ?? [],
  });

  return { id: created.walletId, address: created.accountAddress };
}

/**
 * Sign and broadcast a transaction using the Dynamic Node SDK.
 * The MPC wallet's private key is never held in full on this server —
 * Dynamic co-signs using their key share.
 */
export async function sendTransaction(
  walletId: string,
  to: string,
  data: string,
  provider: ethers.JsonRpcProvider
): Promise<string> {
  const client  = await getClient();
  const stored  = loadWalletStore();

  if (!stored) {
    throw new Error("[Dynamic] No wallet store found — call getOrCreateAgentWallet() first");
  }

  const feeData = await provider.getFeeData();
  const nonce   = await provider.getTransactionCount(stored.accountAddress);
  const network = await provider.getNetwork();

  // Build a viem-compatible transaction object for the Node SDK
  const transaction = {
    to:                   to as `0x${string}`,
    data:                 data as `0x${string}`,
    chainId:              Number(network.chainId),
    nonce,
    maxFeePerGas:         feeData.maxFeePerGas         ?? BigInt("1000000000"),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? BigInt("1000000000"),
    gas:                  BigInt("500000"),
    type:                 "eip1559" as const,
  };

  logger.info(`[Dynamic] Signing transaction via Node SDK (nonce=${nonce})`);

  const signedTx = await client.signTransaction({
    senderAddress:          stored.accountAddress,
    transaction,
    externalServerKeyShares: stored.externalServerKeyShares,
  });

  // Broadcast the serialized signed transaction
  const txResponse = await provider.broadcastTransaction(signedTx);
  logger.info(`[Dynamic] Transaction broadcast: ${txResponse.hash}`);

  return txResponse.hash;
}
