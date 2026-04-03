import { NextResponse } from "next/server";
import { ethers } from "ethers";

const ARC_RPC          = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;

const CONTRACT_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
];

export async function GET() {
  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const count    = Number(await contract.marketCount());

    const results = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        try {
          const m = await contract.getMarket(i);
          return {
            id:            i,
            question:      m.question,
            options:       Array.from(m.options as string[]),
            expiry:        Number(m.expiry),
            totalPool:     m.totalPool.toString(),
            optionPools:   Array.from(m.optionPools as bigint[]).map((v) => v.toString()),
            winningOption: Number(m.winningOption),
            resolved:      m.resolved,
            cancelled:     m.cancelled,
            storageHash:   m.storageHash,
          };
        } catch {
          return null;
        }
      })
    );

    const markets = results.filter(Boolean);
    return NextResponse.json({ markets });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
