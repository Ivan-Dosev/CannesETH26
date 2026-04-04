"use client";

/**
 * Initializes the Dynamic JS SDK client on the client side.
 * Replaces the old DynamicContextProvider + DynamicWagmiConnector setup.
 */

import { useEffect } from "react";
import { getDynamicClient } from "@/lib/dynamicClient";

export function DynamicProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Kick off client initialization (lazy, runs once client-side)
    getDynamicClient();
  }, []);

  return <>{children}</>;
}
