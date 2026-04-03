import { ethers } from "hardhat";

const CONTRACT_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
  "function resolveMarket(uint256 marketId, uint256 winningOption)",
];

async function main() {
  const [owner] = await ethers.getSigners();
  const contract = new ethers.Contract(
    process.env.CONTRACT_ADDRESS!,
    CONTRACT_ABI,
    owner
  );

  const marketIdArg     = process.env.MARKET_ID;
  const winningOptionArg = process.env.WINNING_OPTION;

  const count = Number(await contract.marketCount());
  console.log(`\nTotal markets: ${count}`);
  console.log("─".repeat(60));

  // Print all markets so the user can pick
  for (let i = 0; i < count; i++) {
    const m = await contract.getMarket(i);
    const expiry   = Number(m.expiry);
    const now      = Math.floor(Date.now() / 1000);
    const expired  = now >= expiry;
    const poolUsdc = (Number(m.totalPool) / 1e6).toFixed(2);
    const status   = m.resolved ? "✅ resolved" : m.cancelled ? "❌ cancelled" : expired ? "⏰ expired (ready)" : `⏳ ${expiry - now}s left`;

    console.log(`\nMarket ${i}: ${status}`);
    console.log(`  Question:  ${m.question}`);
    m.options.forEach((opt: string, j: number) => {
      const pool = (Number(m.optionPools[j]) / 1e6).toFixed(2);
      console.log(`  [${j}] ${opt}  — $${pool} USDC`);
    });
    console.log(`  Total pool: $${poolUsdc} USDC`);
  }

  console.log("\n" + "─".repeat(60));

  // If MARKET_ID and WINNING_OPTION are set, resolve it
  if (marketIdArg !== undefined && winningOptionArg !== undefined) {
    const marketId     = parseInt(marketIdArg);
    const winningOption = parseInt(winningOptionArg);

    const m   = await contract.getMarket(marketId);
    const now = Math.floor(Date.now() / 1000);

    if (m.resolved)  { console.log(`Market ${marketId} is already resolved.`); return; }
    if (m.cancelled) { console.log(`Market ${marketId} is cancelled.`); return; }
    if (Number(m.expiry) > now) {
      const remaining = Number(m.expiry) - now;
      console.log(`Market ${marketId} hasn't expired yet. ${remaining}s remaining.`);
      return;
    }

    console.log(`\nResolving market ${marketId}...`);
    console.log(`  Winning option: [${winningOption}] ${m.options[winningOption]}`);
    const tx = await contract.resolveMarket(marketId, winningOption);
    await tx.wait();
    console.log(`✅ Market ${marketId} resolved! TX: ${tx.hash}`);
    console.log(`   Winners bet on: "${m.options[winningOption]}"`);
    console.log(`   They can now claim their share of $${(Number(m.totalPool) / 1e6).toFixed(2)} USDC`);
  } else {
    console.log("\nTo resolve a market, run:");
    console.log("  MARKET_ID=0 WINNING_OPTION=0 npm run resolve:arc");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
