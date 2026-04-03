import { ethers } from "ethers";

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS!;
export const USDC_ADDRESS     = process.env.NEXT_PUBLIC_USDC_ADDRESS!;
export const ARC_CHAIN_ID     = parseInt(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "1234");

export const CONTRACT_ABI = [
  "function marketCount() view returns (uint256)",
  "function getMarket(uint256) view returns (string question, string[] options, uint256 expiry, uint256 totalPool, uint256[] optionPools, uint256 winningOption, bool resolved, bool cancelled, string storageHash)",
  "function getUserBet(uint256 marketId, address user) view returns (uint256 amount, uint256 optionIndex, bool claimed)",
  "function getActiveMarkets() view returns (uint256[] ids)",
  "function placeBet(uint256 marketId, uint256 optionIndex, uint256 amount)",
  "function claimWinnings(uint256 marketId)",
  "event MarketCreated(uint256 indexed marketId, string question, string[] options, uint256 expiry, string storageHash)",
  "event BetPlaced(uint256 indexed marketId, address indexed bettor, uint256 optionIndex, uint256 amount)",
  "event MarketResolved(uint256 indexed marketId, uint256 winningOption)",
];

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

export interface Market {
  id:          number;
  question:    string;
  options:     string[];
  expiry:      number;
  totalPool:   bigint;
  optionPools: bigint[];
  winningOption: number;
  resolved:    boolean;
  cancelled:   boolean;
  storageHash: string;
}

export interface UserBet {
  amount:      bigint;
  optionIndex: number;
  claimed:     boolean;
}

export function getProvider() {
  const rpc = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.arc.network";
  return new ethers.JsonRpcProvider(rpc);
}

export function getContract(signerOrProvider?: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(
    CONTRACT_ADDRESS,
    CONTRACT_ABI,
    signerOrProvider ?? getProvider()
  );
}

export async function fetchAllMarkets(): Promise<Market[]> {
  const contract = getContract();
  const count    = Number(await contract.marketCount());
  const markets: Market[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const m = await contract.getMarket(i);
      markets.push({
        id:           i,
        question:     m.question,
        options:      m.options,
        expiry:       Number(m.expiry),
        totalPool:    m.totalPool,
        optionPools:  m.optionPools,
        winningOption: Number(m.winningOption),
        resolved:     m.resolved,
        cancelled:    m.cancelled,
        storageHash:  m.storageHash,
      });
    } catch (_) {
      // skip
    }
  }

  return markets;
}

export function formatUsdc(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(2);
}

export function getOptionOdds(market: Market, optionIndex: number): string {
  if (market.totalPool === 0n) return "—";
  const pool = market.optionPools[optionIndex] ?? 0n;
  if (pool === 0n) return "∞";
  const odds = Number(market.totalPool) / Number(pool);
  return `${odds.toFixed(2)}x`;
}

export function getOptionPct(market: Market, optionIndex: number): number {
  if (market.totalPool === 0n) return 50;
  const pool = market.optionPools[optionIndex] ?? 0n;
  return Math.round((Number(pool) / Number(market.totalPool)) * 100);
}
