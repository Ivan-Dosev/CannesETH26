import { ethers } from "hardhat";

const CONTRACT_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
  "function cancelMarket(uint256 marketId)",
];

async function main() {
  const [owner] = await ethers.getSigners();
  const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS!,
    CONTRACT_ABI,
    owner
  );

  const count = Number(await contract.marketCount());
  console.log(`Total markets: ${count}`);

  for (let i = 0; i < count; i++) {
    const m = await contract.getMarket(i);
    if (m.resolved || m.cancelled) {
      console.log(`Market ${i}: already ${m.resolved ? "resolved" : "cancelled"} — skip`);
      continue;
    }
    console.log(`Cancelling market ${i}: "${m.question}"`);
    const tx = await contract.cancelMarket(i);
    await tx.wait();
    console.log(`  ✅ Cancelled. TX: ${tx.hash}`);
  }

  console.log("Done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
