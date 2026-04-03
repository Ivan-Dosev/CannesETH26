"use client";

import { useState } from "react";
import { ethers } from "ethers";
import { useWalletClient } from "wagmi";
import {
  Market,
  CONTRACT_ADDRESS,
  USDC_ADDRESS,
  CONTRACT_ABI,
  ERC20_ABI,
  ARC_CHAIN_ID,
  getOptionOdds,
} from "@/lib/contract";

const ARC_RPC      = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_HEX = "0x" + ARC_CHAIN_ID.toString(16);

interface Props {
  market:    Market;
  onClose:   () => void;
  onSuccess: () => void;
}

const OPTION_COLORS = [
  "border-px-purple text-px-purple bg-px-purple/10",
  "border-px-cyan   text-px-cyan   bg-px-cyan/10",
  "border-px-green  text-px-green  bg-px-green/10",
];
const OPTION_SELECTED = [
  "border-px-purple bg-px-purple   text-white",
  "border-px-cyan   bg-px-cyan     text-black",
  "border-px-green  bg-px-green    text-black",
];

export function BetModal({ market, onClose, onSuccess }: Props) {
  const { data: walletClient } = useWalletClient();
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [amount,  setAmount]  = useState("");
  const [status,  setStatus]  = useState<"idle" | "switching" | "approving" | "betting" | "claiming" | "done" | "error">("idle");
  const [errorMsg, setError]  = useState("");

  async function getSigner() {
    if (!walletClient) throw new Error("Connect your wallet first");
    const provider = new ethers.BrowserProvider(walletClient.transport);
    const network  = await provider.getNetwork();

    if (Number(network.chainId) !== ARC_CHAIN_ID) {
      setStatus("switching");
      try {
        await provider.send("wallet_switchEthereumChain", [{ chainId: ARC_CHAIN_HEX }]);
      } catch (err: any) {
        if (err.code === 4902 || err.code === -32603) {
          await provider.send("wallet_addEthereumChain", [{
            chainId:           ARC_CHAIN_HEX,
            chainName:         "Arc Testnet",
            nativeCurrency:    { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls:           [ARC_RPC],
            blockExplorerUrls: ["https://testnet.arcscan.app"],
          }]);
        } else {
          throw err;
        }
      }
    }

    return provider.getSigner();
  }

  async function handleBet() {
    if (selectedOption === null) return;
    const usdcAmount = parseFloat(amount);
    if (isNaN(usdcAmount) || usdcAmount < 1) {
      setError("Minimum bet is 1 USDC");
      setStatus("error");
      return;
    }

    try {
      const signer       = await getSigner();
      const usdcWei      = ethers.parseUnits(amount, 6);
      const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
      const betContract  = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

      const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
      const usdcRead    = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, arcProvider);
      const allowance   = await usdcRead.allowance(await signer.getAddress(), CONTRACT_ADDRESS);

      if (allowance < usdcWei) {
        setStatus("approving");
        const approveTx = await usdcContract.approve(CONTRACT_ADDRESS, ethers.MaxUint256);
        await approveTx.wait();
      }

      setStatus("betting");
      const tx = await betContract.placeBet(market.id, selectedOption, usdcWei);
      await tx.wait();
      setStatus("done");
      setTimeout(onSuccess, 1500);
    } catch (err: any) {
      setError(err.message ?? "Transaction failed");
      setStatus("error");
    }
  }

  async function handleClaim() {
    try {
      setStatus("claiming");
      const signer      = await getSigner();
      const betContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx          = await betContract.claimWinnings(market.id);
      await tx.wait();
      setStatus("done");
      setTimeout(onSuccess, 1500);
    } catch (err: any) {
      setError(err.message ?? "Claim failed");
      setStatus("error");
    }
  }

  const isClaim  = market.resolved;
  const busy     = status !== "idle" && status !== "error";

  const STATUS_MSG: Record<string, string> = {
    switching: "⚡ Switching to Arc network...",
    approving: "⏳ Approving USDC...",
    betting:   "⏳ Placing bet...",
    claiming:  "⏳ Claiming winnings...",
    done:      isClaim ? "✓ Winnings claimed!" : "✓ Bet placed!",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-px-card pixel-border-purple w-full max-w-md mx-4 font-pixel">

        {/* Title bar */}
        <div className="bg-px-purple/20 border-b-2 border-px-border px-5 py-3 flex items-center justify-between">
          <span className="text-px-purple neon-purple font-bold text-sm uppercase tracking-widest">
            {isClaim ? "★ CLAIM WINNINGS" : "▶ PLACE BET"}
          </span>
          <button
            onClick={onClose}
            className="text-px-dim hover:text-white transition-colors text-lg leading-none font-bold"
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Question */}
          <p className="font-sans text-gray-200 text-sm leading-relaxed border-l-2 border-px-purple pl-3">
            {market.question}
          </p>

          {!isClaim && (
            <>
              {/* Option selector */}
              <div>
                <p className="text-px-dim text-xs uppercase tracking-widest mb-2">Select outcome</p>
                <div className="flex flex-col gap-2">
                  {market.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedOption(i)}
                      className={`btn-pixel flex items-center justify-between px-3 py-2.5 text-xs transition-all border-2 ${
                        selectedOption === i
                          ? OPTION_SELECTED[i % OPTION_SELECTED.length]
                          : OPTION_COLORS[i % OPTION_COLORS.length]
                      }`}
                    >
                      <span className="font-sans font-semibold text-sm">{selectedOption === i ? "▶ " : "  "}{opt}</span>
                      <span className="opacity-70 font-sans">{getOptionOdds(market, i)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div>
                <p className="text-px-dim text-xs uppercase tracking-widest mb-2">Amount (USDC)</p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    placeholder="10"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="flex-1 bg-px-bg border-2 border-px-border focus:border-px-purple px-3 py-2 text-white text-xs font-pixel outline-none transition-colors"
                  />
                  {["10", "50", "100"].map((v) => (
                    <button
                      key={v}
                      onClick={() => setAmount(v)}
                      className="btn-pixel border-2 border-px-border hover:border-px-purple text-px-dim hover:text-white px-3 py-2 text-xs transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Status messages */}
          {status in STATUS_MSG && (
            <div className={`text-xs text-center py-2 border ${
              status === "done"  ? "border-px-green  text-px-green  neon-green"  :
              status === "error" ? "border-px-red    text-px-red"                :
                                   "border-px-yellow text-px-yellow neon-yellow"
            }`}>
              {STATUS_MSG[status]}
            </div>
          )}
          {status === "error" && (
            <p className="text-px-red text-xs break-all leading-relaxed">{errorMsg}</p>
          )}

          {/* Action button */}
          {status !== "done" && (
            <button
              onClick={isClaim ? handleClaim : handleBet}
              disabled={busy || (!isClaim && (selectedOption === null || !amount))}
              className={`btn-pixel w-full font-pixel font-bold py-3 text-sm uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                isClaim
                  ? "bg-px-green text-black border-2 border-px-green hover:brightness-110"
                  : "bg-px-purple text-white border-2 border-px-purple hover:bg-purple-700"
              }`}
            >
              {busy
                ? "PROCESSING..."
                : isClaim
                ? "💰 CLAIM NOW"
                : selectedOption === null
                ? "SELECT AN OUTCOME"
                : `BET ${amount || "?"} USDC`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
