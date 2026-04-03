import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // ── Addresses ────────────────────────────────────────────────────────────
  // Arc testnet USDC — native gas token. Get address from Arc docs or arcscan.app
  // Arc testnet USDC — ERC-20 interface for the native USDC balance (docs.arc.network/arc/references/contract-addresses)
  const usdcRaw      = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
  const agentRaw     = process.env.AI_AGENT_ADDRESS || deployer.address;
  const resolverRaw  = process.env.CHAINLINK_RESOLVER || deployer.address;

  const USDC_ADDRESS       = ethers.getAddress(usdcRaw);
  const AI_AGENT_ADDRESS   = ethers.getAddress(agentRaw);
  const CHAINLINK_RESOLVER = ethers.getAddress(resolverRaw);

  // ── Deploy ────────────────────────────────────────────────────────────────
  const Factory = await ethers.getContractFactory("PredictionMarket");
  const contract = await Factory.deploy(
    USDC_ADDRESS,
    AI_AGENT_ADDRESS,
    CHAINLINK_RESOLVER,
    { gasLimit: 3_000_000 }
  );
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✅ PredictionMarket deployed to:", address);
  console.log("   USDC:              ", USDC_ADDRESS);
  console.log("   AI Agent:          ", AI_AGENT_ADDRESS);
  console.log("   Chainlink Resolver:", CHAINLINK_RESOLVER);

  // ── Save deployment info ──────────────────────────────────────────────────
  const deploymentInfo = {
    network:           (await ethers.provider.getNetwork()).name,
    chainId:           (await ethers.provider.getNetwork()).chainId.toString(),
    contractAddress:   address,
    usdcAddress:       USDC_ADDRESS,
    aiAgent:           AI_AGENT_ADDRESS,
    chainlinkResolver: CHAINLINK_RESOLVER,
    deployedAt:        new Date().toISOString(),
    deployer:          deployer.address,
  };

  const outDir = path.join(__dirname, "../deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "deployment.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  // Also write ABI for the frontend / agent
  const artifact = await ethers.getContractFactory("PredictionMarket");
  const abi = JSON.parse(artifact.interface.formatJson());
  fs.writeFileSync(
    path.join(outDir, "abi.json"),
    JSON.stringify(abi, null, 2)
  );

  console.log("\n📄 Deployment info saved to contracts/deployments/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
