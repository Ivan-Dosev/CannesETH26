"use client";

import { useState } from "react";
import { ethers } from "ethers";
import {
  Market,
  UserBet,
  CONTRACT_ADDRESS,
  USDC_ADDRESS,
  CONTRACT_ABI,
  ERC20_ABI,
  ARC_CHAIN_ID,
  getOptionOdds,
} from "@/lib/contract";

const ARC_RPC       = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_CHAIN_HEX = "0x" + ARC_CHAIN_ID.toString(16);

interface Props {
  market:         Market;
  userBet?:       UserBet | null;
  sessionWallet?: ethers.NonceManager | null;
  onClose:        () => void;
  onSuccess:      () => void;
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

export function BetModal({ market, userBet, sessionWallet, onClose, onSuccess }: Props) {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [amount,  setAmount]  = useState("");
  const [status,  setStatus]  = useState<"idle" | "switching" | "approving" | "betting" | "claiming" | "done" | "error">("idle");
  const [errorMsg, setError]  = useState("");
  const [txHash,   setTxHash] = useState("");

  // Use window.ethereum directly — bypasses wagmi's mainnet-locked transport.
  // After wallet_switchEthereumChain we create a FRESH BrowserProvider so ethers
  // doesn't throw NETWORK_ERROR from detecting the chain change on a stale instance.
  async function getSigner() {
    const ethereum = (window as any).ethereum;
    if (!ethereum) throw new Error("No wallet found — connect via the button above");

    const chainIdHex = await ethereum.request({ method: "eth_chainId" }) as string;
    if (parseInt(chainIdHex, 16) !== ARC_CHAIN_ID) {
      setStatus("switching");
      try {
        await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
      } catch (err: any) {
        if (err.code === 4902 || err.code === -32603) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId:           ARC_CHAIN_HEX,
              chainName:         "Arc Testnet",
              nativeCurrency:    { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls:           [ARC_RPC],
              blockExplorerUrls: ["https://testnet.arcscan.app"],
            }],
          });
        } else {
          throw err;
        }
      }
    }

    // Fresh provider on the now-correct chain
    return new ethers.BrowserProvider(ethereum).getSigner();
  }

  async function handleBet() {
    if (selectedOption === null || status !== "idle") return;
    const usdcAmount = parseFloat(amount);
    if (isNaN(usdcAmount) || usdcAmount < 0.01) {
      setError("Minimum bet is 0.01 USDC");
      setStatus("error");
      return;
    }

    setStatus("switching"); // disable button immediately before any async work
    try {
      const signer       = await getSigner();
      // Round to 6 decimal places max (USDC has 6 decimals)
      const rounded      = usdcAmount.toFixed(6);
      const usdcWei      = ethers.parseUnits(rounded, 6);
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
      setTxHash(tx.hash);
      await tx.wait();
      setStatus("done");
      setTimeout(onSuccess, 2500);
    } catch (err: any) {
      const msg = err?.reason ?? err?.message ?? JSON.stringify(err) ?? "Transaction failed";
      setError(msg.slice(0, 300));
      setStatus("error");
    }
  }

  async function handleClaim() {
    if (status !== "idle") return;
    try {
      setStatus("claiming");
      // If the bet was placed by the session wallet, claim using that signer directly
      // (no MetaMask popup needed — the key is already in memory)
      let signer: ethers.Signer;
      if (userBet?.betFromSession && sessionWallet) {
        signer = sessionWallet;
      } else {
        signer = await getSigner();
      }
      const betContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx          = await betContract.claimWinnings(market.id);
      setTxHash(tx.hash);
      await tx.wait();
      setStatus("done");
      setTimeout(onSuccess, 2500);
    } catch (err: any) {
      const msg = err?.reason ?? err?.message ?? JSON.stringify(err) ?? "Claim failed";
      setError(msg.slice(0, 300));
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
                    min="0.01"
                    step="0.01"
                    placeholder="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="flex-1 bg-px-bg border-2 border-px-border focus:border-px-purple px-3 py-2 text-white text-xs font-pixel outline-none transition-colors"
                  />
                  {["0.1", "1", "10"].map((v) => (
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
          {status !== "idle" && (
            <div className={`text-xs text-center py-3 px-3 border flex flex-col gap-2 ${
              status === "done"  ? "border-px-green  text-px-green  bg-px-green/10"  :
              status === "error" ? "border-red-500   text-red-400   bg-red-500/10"   :
                                   "border-px-yellow text-px-yellow bg-px-yellow/10 animate-pulse"
            }`}>
              <span>{STATUS_MSG[status] ?? "⏳ Processing..."}</span>
              {txHash && (
                <a
                  href={`https://testnet.arcscan.app/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-px-cyan underline font-mono text-xs break-all"
                >
                  tx: {txHash.slice(0, 18)}…{txHash.slice(-6)} ↗
                </a>
              )}
              {status === "error" && (
                <span className="text-red-400 text-xs break-all leading-relaxed text-left">{errorMsg}</span>
              )}
            </div>
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
                : `BET ${amount || "?"} USDC`
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
