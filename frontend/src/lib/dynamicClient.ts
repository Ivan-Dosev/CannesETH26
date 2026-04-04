/**
 * Dynamic JS SDK client singleton.
 *
 * Uses the new headless @dynamic-labs-sdk/client + @dynamic-labs-sdk/evm packages.
 * Lazy-initialized client-side only (SSR guard).
 */

import { createDynamicClient } from "@dynamic-labs-sdk/client";
import { addEvmExtension } from "@dynamic-labs-sdk/evm";

type DynamicClient = ReturnType<typeof createDynamicClient>;

let _client: DynamicClient | null = null;

export function getDynamicClient(): DynamicClient | null {
  if (typeof window === "undefined") return null; // SSR guard
  if (_client) return _client;

  _client = createDynamicClient({
    environmentId: process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID!,
    metadata: {
      name: "AlphaMarket",
    },
  });

  // Register EVM extension immediately after creating the client
  addEvmExtension();

  return _client;
}
