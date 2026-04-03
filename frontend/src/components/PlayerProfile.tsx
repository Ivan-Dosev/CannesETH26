"use client";

import { useDynamicContext, useUserWallets } from "@dynamic-labs/sdk-react-core";

interface Props {
  usdcBalance:  string;
  betsPlaced:   number;
  betsWon:      number;
  totalWagered: bigint;
  verifiedUser: { userId: string; wallets: any[] } | null;
  onOpenProfile: () => void;
}

function truncate(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export function PlayerProfile({ usdcBalance, betsPlaced, betsWon, totalWagered, verifiedUser, onOpenProfile }: Props) {
  const { primaryWallet, user, handleLogOut } = useDynamicContext();
  const userWallets = useUserWallets();

  if (!primaryWallet) return null;

  const displayName  = user?.email ?? user?.username ?? truncate(primaryWallet.address);
  const connectorName = (primaryWallet as any).connector?.name ?? primaryWallet.connector;
  const winRate      = betsPlaced > 0 ? Math.round((betsWon / betsPlaced) * 100) : 0;

  return (
    <div className="mb-8 bg-px-card border-2 border-px-purple p-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-px-purple font-pixel text-xs uppercase tracking-widest">⬡ Dynamic Identity</span>
            {verifiedUser && (
              <span className="bg-px-green/20 border border-px-green text-px-green font-pixel text-xs px-2 py-0.5 uppercase tracking-wide">
                ✓ JWT Verified
              </span>
            )}
          </div>
          <h3 className="text-white font-sans font-bold text-lg break-all">{displayName}</h3>
          {verifiedUser && (
            <p className="text-px-dim font-pixel text-xs mt-0.5 uppercase tracking-widest">
              ID: {verifiedUser.userId.slice(0, 16)}…
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onOpenProfile}
            className="btn-pixel border border-px-purple text-px-purple hover:bg-px-purple hover:text-white font-pixel text-xs px-3 py-1.5 uppercase tracking-wide transition-colors"
          >
            PROFILE
          </button>
          <button
            onClick={handleLogOut}
            className="btn-pixel border border-px-border text-px-dim hover:border-px-red hover:text-px-red font-pixel text-xs px-3 py-1.5 uppercase tracking-wide transition-colors"
          >
            LOGOUT
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {[
          { label: "USDC Balance", value: `$${usdcBalance}`, color: "text-px-yellow" },
          { label: "Bets Placed",  value: betsPlaced,         color: "text-px-cyan"   },
          { label: "Bets Won",     value: betsWon,            color: "text-px-green"  },
          { label: "Win Rate",     value: `${winRate}%`,      color: winRate >= 50 ? "text-px-green" : "text-px-red" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-px-bg border border-px-border p-3 text-center">
            <div className={`font-sans font-bold text-xl ${color}`}>{value}</div>
            <div className="font-pixel text-xs text-px-dim uppercase tracking-widest mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Linked wallets from Dynamic */}
      <div>
        <p className="font-pixel text-xs text-px-dim uppercase tracking-widest mb-2">
          Linked Wallets ({userWallets.length})
        </p>
        <div className="flex flex-col gap-1">
          {userWallets.map((w, i) => (
            <div key={w.address} className="flex items-center justify-between bg-px-bg border border-px-border px-3 py-2">
              <div className="flex items-center gap-2">
                {w.address === primaryWallet.address && (
                  <span className="font-pixel text-xs text-px-purple border border-px-purple px-1.5 py-0.5 uppercase">PRIMARY</span>
                )}
                <span className="font-sans text-xs text-gray-300 font-mono">{truncate(w.address)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-pixel text-xs text-px-dim uppercase">
                  {(w as any).connector?.name ?? (w as any).chain ?? "EVM"}
                </span>
                {verifiedUser?.wallets?.some((vc: any) => vc.address?.toLowerCase() === w.address.toLowerCase()) && (
                  <span className="text-px-green font-pixel text-xs">✓</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connection method */}
      {connectorName && (
        <p className="mt-3 font-pixel text-xs text-px-dim uppercase tracking-widest">
          Connected via: <span className="text-px-purple">{connectorName}</span>
          {user?.email && <span className="ml-3 text-px-cyan">{user.email}</span>}
        </p>
      )}
    </div>
  );
}
