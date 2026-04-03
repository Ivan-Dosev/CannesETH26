import { NextResponse } from "next/server";
import { ethers } from "ethers";

const ARC_RPC          = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;

const CONTRACT_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
];

// Module-level cached provider — created once, reused across requests
let _provider: ethers.JsonRpcProvider | null = null;
function getProvider() {
  if (!_provider) _provider = new ethers.JsonRpcProvider(ARC_RPC);
  return _provider;
}

// Simple in-memory cache: avoid re-fetching resolved markets that won't change
interface CachedMarket {
  id: number; question: string; options: string[]; expiry: number;
  totalPool: string; optionPools: string[]; winningOption: number;
  resolved: boolean; cancelled: boolean; storageHash: string;
}
const marketCache = new Map<number, CachedMarket>();

export async function GET() {
  try {
    const provider = getProvider();
    const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const count    = Number(await contract.marketCount());

    // Fetch all markets in parallel, using cache for resolved/cancelled ones
    const results = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        // Return cached copy if market is already final (resolved or cancelled)
        const cached = marketCache.get(i);
        if (cached && (cached.resolved || cached.cancelled)) return cached;

        try {
          const m = await contract.getMarket(i);
          const market: CachedMarket = {
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
          marketCache.set(i, market);
          return market;
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
