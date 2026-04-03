import { NextResponse } from "next/server";
import { ethers } from "ethers";

const ETH_RPC = "https://ethereum-rpc.publicnode.com";

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

const FEEDS: Record<string, { address: string; decimals?: number; divisor?: number }> = {
  "ETH/USD": { address: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" },
  "SOL/USD": { address: "0x4ffC43a60e009B551865A93d232E33Fce9f01507" },
  "ETH_GAS": { address: "0x169E633A2D1E6c10dD91238Ba11c4A708dfEF37C", divisor: 1e9 },
};

export async function GET() {
  try {
    const provider = new ethers.JsonRpcProvider(ETH_RPC);
    const results: Record<string, number> = {};

    await Promise.all(
      Object.entries(FEEDS).map(async ([key, { address, divisor }]) => {
        try {
          const c = new ethers.Contract(address, AGGREGATOR_ABI, provider);
          const [rd, dec] = await Promise.all([c.latestRoundData(), c.decimals()]);
          const d = divisor ?? Math.pow(10, Number(dec));
          results[key] = Number(rd.answer) / d;
        } catch {
          // skip failed feed
        }
      })
    );

    return NextResponse.json(results, {
      headers: { "Cache-Control": "s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
