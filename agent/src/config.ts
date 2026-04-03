import * as dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  zeroG: {
    computeEndpoint: process.env.ZG_COMPUTE_ENDPOINT ?? "https://api.0g.ai/v1",
    apiKey:          process.env.ZG_API_KEY          ?? "",   // optional — falls back to demo markets
    storageNodeUrl:  process.env.ZG_STORAGE_NODE_URL ?? "https://storage-node.0g.ai",
    evmRpcUrl:       process.env.ZG_EVMRPC_URL       ?? "https://evmrpc-testnet.0g.ai",
    privateKey:      process.env.ZG_PRIVATE_KEY       ?? "",  // optional — only needed for 0G Storage uploads
  },
  dynamic: {
    apiKey: process.env.DYNAMIC_API_KEY ?? "",  // optional — falls back to direct ethers signer
    envId:  process.env.DYNAMIC_ENV_ID  ?? "",
  },
  contract: {
    address:  required("CONTRACT_ADDRESS"),
    rpcUrl:   required("ARC_RPC_URL"),
    chainId:  parseInt(process.env.ARC_CHAIN_ID ?? "5042002"),
    // Fallback: use deployer private key directly if no Dynamic server wallet yet
    privateKey: process.env.DEPLOYER_PRIVATE_KEY ?? "",
  },
  agent: {
    cronSchedule:       process.env.AGENT_CRON_SCHEDULE      ?? "0 */6 * * *",
    marketDurationSecs: parseInt(process.env.MARKET_DURATION_SECONDS ?? "86400"),
  },
} as const;
