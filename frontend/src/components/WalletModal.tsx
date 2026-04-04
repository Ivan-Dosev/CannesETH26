"use client";

/**
 * Custom headless wallet connect modal built on Dynamic JS SDK.
 * Replaces DynamicWidget from the old React SDK.
 *
 * Supports:
 *  - External wallet providers (MetaMask, etc.) via getAvailableWalletProvidersData()
 *  - Email OTP embedded wallet via sendEmailOTP() + verifyOTP()
 */

import { useState, useEffect } from "react";
import {
  getAvailableWalletProvidersData,
  connectAndVerifyWithWalletProvider,
  sendEmailOTP,
  verifyOTP,
  waitForClientInitialized,
  type OTPVerification,
} from "@dynamic-labs-sdk/client";

interface Props {
  onClose:     () => void;
  onConnected: () => void;
}

type Screen = "picker" | "email" | "otp";

export function WalletModal({ onClose, onConnected }: Props) {
  const [screen,   setScreen]   = useState<Screen>("picker");
  const [providers, setProviders] = useState<ReturnType<typeof getAvailableWalletProvidersData>>([]);
  const [email,    setEmail]    = useState("");
  const [otpCode,  setOtpCode]  = useState("");
  const [otpData,  setOtpData]  = useState<OTPVerification | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    waitForClientInitialized()
      .then(() => {
        setProviders(getAvailableWalletProvidersData());
      })
      .catch(console.error);
  }, []);

  async function handleWalletProvider(walletProviderKey: string) {
    setLoading(true);
    setError(null);
    try {
      await connectAndVerifyWithWalletProvider({ walletProviderKey });
      onConnected();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Failed to connect wallet");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOTP() {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      // sendEmailOTP returns OTPVerification directly
      const otpVerification = await sendEmailOTP({ email });
      setOtpData(otpVerification);
      setScreen("otp");
    } catch (e: any) {
      setError(e.message ?? "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOTP() {
    if (!otpData || !otpCode) return;
    setLoading(true);
    setError(null);
    try {
      await verifyOTP({ otpVerification: otpData, verificationToken: otpCode });

      // Create embedded WaaS wallet after successful OTP verification
      try {
        const { getChainsMissingWaasWalletAccounts, createWaasWalletAccounts } =
          await import("@dynamic-labs-sdk/client/waas");
        const missingChains = getChainsMissingWaasWalletAccounts();
        if (missingChains.length > 0) {
          await createWaasWalletAccounts({ chains: missingChains });
        }
      } catch {
        // WaaS wallet creation is best-effort
      }

      onConnected();
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Invalid OTP code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-px-card border-2 border-px-purple w-full max-w-sm mx-4 p-6 relative">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-pixel text-px-purple uppercase tracking-widest text-sm neon-purple">
            {screen === "picker" ? "Connect Wallet" : screen === "email" ? "Email Login" : "Enter OTP"}
          </h2>
          <button onClick={onClose} className="text-px-dim hover:text-white font-pixel text-lg leading-none">✕</button>
        </div>

        {error && (
          <div className="mb-4 border border-red-500/60 bg-red-500/10 text-red-400 font-pixel text-xs px-3 py-2 uppercase">
            {error}
          </div>
        )}

        {/* Wallet picker screen */}
        {screen === "picker" && (
          <div className="space-y-2">
            {providers.length === 0 && (
              <p className="text-px-dim font-pixel text-xs uppercase text-center py-4">
                Loading wallets…
              </p>
            )}
            {providers.map((p) => (
              <button
                key={p.key}
                onClick={() => handleWalletProvider(p.key)}
                disabled={loading}
                className="w-full flex items-center gap-3 border border-px-border hover:border-px-purple bg-px-bg hover:bg-px-purple/10 px-4 py-3 transition-colors disabled:opacity-50"
              >
                {p.metadata.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.metadata.icon} alt={p.metadata.displayName} className="w-6 h-6 object-contain" />
                )}
                <span className="font-pixel text-xs text-white uppercase tracking-wide">{p.metadata.displayName}</span>
              </button>
            ))}

            <div className="relative flex items-center gap-2 my-3">
              <div className="flex-1 border-t border-px-border" />
              <span className="font-pixel text-px-dim text-xs uppercase">or</span>
              <div className="flex-1 border-t border-px-border" />
            </div>

            <button
              onClick={() => setScreen("email")}
              className="w-full flex items-center gap-3 border border-px-cyan/50 hover:border-px-cyan bg-px-bg hover:bg-px-cyan/10 px-4 py-3 transition-colors"
            >
              <span className="text-lg">✉</span>
              <span className="font-pixel text-xs text-px-cyan uppercase tracking-wide">Email (Embedded Wallet)</span>
            </button>
          </div>
        )}

        {/* Email input screen */}
        {screen === "email" && (
          <div className="space-y-3">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-px-bg border border-px-border focus:border-px-cyan outline-none px-3 py-2 text-white font-sans text-sm"
              onKeyDown={e => e.key === "Enter" && handleSendOTP()}
              autoFocus
            />
            <button
              onClick={handleSendOTP}
              disabled={loading || !email}
              className="w-full bg-px-cyan/20 border border-px-cyan hover:bg-px-cyan/30 text-px-cyan font-pixel text-xs uppercase tracking-widest py-2.5 transition-colors disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send Code"}
            </button>
            <button
              onClick={() => setScreen("picker")}
              className="w-full text-px-dim font-pixel text-xs uppercase tracking-wide hover:text-white transition-colors py-1"
            >
              ← Back
            </button>
          </div>
        )}

        {/* OTP verification screen */}
        {screen === "otp" && (
          <div className="space-y-3">
            <p className="text-px-dim font-pixel text-xs uppercase tracking-wide">
              Code sent to {email}
            </p>
            <input
              type="text"
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              maxLength={6}
              className="w-full bg-px-bg border border-px-border focus:border-px-cyan outline-none px-3 py-2 text-white font-pixel text-xl text-center tracking-[0.5em]"
              onKeyDown={e => e.key === "Enter" && handleVerifyOTP()}
              autoFocus
            />
            <button
              onClick={handleVerifyOTP}
              disabled={loading || otpCode.length < 6}
              className="w-full bg-px-purple/20 border border-px-purple hover:bg-px-purple/30 text-px-purple font-pixel text-xs uppercase tracking-widest py-2.5 transition-colors disabled:opacity-50"
            >
              {loading ? "Verifying…" : "Verify & Connect"}
            </button>
            <button
              onClick={() => { setScreen("email"); setOtpCode(""); }}
              className="w-full text-px-dim font-pixel text-xs uppercase tracking-wide hover:text-white transition-colors py-1"
            >
              ← Resend Code
            </button>
          </div>
        )}

        <p className="mt-5 text-px-dim font-pixel text-xs text-center uppercase tracking-wider opacity-60">
          Secured by Dynamic
        </p>
      </div>
    </div>
  );
}
