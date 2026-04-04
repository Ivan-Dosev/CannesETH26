import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "0x" + "0".repeat(64);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    // Arc (Circle's L1) — update chainId & rpcUrl from Arc docs
    arc: {
      url:      process.env.ARC_RPC_URL    ?? "https://rpc.testnet.arc.network",
      chainId:  parseInt(process.env.ARC_CHAIN_ID ?? "1234"),
      accounts: [DEPLOYER_KEY],
    },
    // Ethereum Sepolia — for CRE workflow simulation
    sepolia: {
      url:      process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      chainId:  11155111,
      accounts: [DEPLOYER_KEY],
    },
    // For local testing
    hardhat: {
      chainId: 31337,
    },
  },
  etherscan: {
    apiKey: {
      arc: process.env.ARC_EXPLORER_API_KEY ?? "",
    },
    customChains: [
      {
        network: "arc",
        chainId: parseInt(process.env.ARC_CHAIN_ID ?? "1234"),
        urls: {
          apiURL:     process.env.ARC_EXPLORER_API_URL    ?? "https://explorer.arc.network/api",
          browserURL: process.env.ARC_EXPLORER_BROWSER_URL ?? "https://explorer.arc.network",
        },
      },
    ],
  },
};

export default config;
