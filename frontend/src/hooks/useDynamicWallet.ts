"use client";

/**
 * React hook wrapping the Dynamic JS SDK (headless).
 * Replaces useDynamicContext / useIsLoggedIn / useUserWallets from the old React SDK.
 */

import { useEffect, useState, useCallback } from "react";
import {
  isSignedIn,
  getWalletAccounts,
  logout as dynamicLogout,
  onEvent,
} from "@dynamic-labs-sdk/client";
import { getDynamicClient } from "@/lib/dynamicClient";

export interface DynamicWalletState {
  address:    string | null;
  isLoggedIn: boolean;
  authToken:  string | null;
  logout:     () => Promise<void>;
  openModal:  () => void;
  closeModal: () => void;
  modalOpen:  boolean;
}

export function useDynamicWallet(): DynamicWalletState {
  const [address,    setAddress]    = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authToken,  setAuthToken]  = useState<string | null>(null);
  const [modalOpen,  setModalOpen]  = useState(false);

  const syncState = useCallback(() => {
    const client = getDynamicClient();
    if (!client) return;

    const signedIn = isSignedIn();
    setIsLoggedIn(signedIn);
    setAuthToken(client.token ?? null);

    if (signedIn) {
      const accounts = getWalletAccounts();
      setAddress(accounts[0]?.address ?? null);
    } else {
      setAddress(null);
    }
  }, []);

  useEffect(() => {
    const client = getDynamicClient();
    if (!client) return;

    // Sync on mount
    syncState();

    // Re-sync when wallet accounts change
    const unsubWallets = onEvent({
      event:    "walletAccountsChanged",
      listener: () => { syncState(); },
    });

    // Re-sync when auth token changes (login/logout)
    const unsubToken = onEvent({
      event:    "tokenChanged",
      listener: () => { syncState(); },
    });

    return () => {
      unsubWallets();
      unsubToken();
    };
  }, [syncState]);

  const logout = useCallback(async () => {
    await dynamicLogout();
    setAddress(null);
    setIsLoggedIn(false);
    setAuthToken(null);
  }, []);

  return {
    address,
    isLoggedIn,
    authToken,
    logout,
    openModal:  () => setModalOpen(true),
    closeModal: () => setModalOpen(false),
    modalOpen,
  };
}
