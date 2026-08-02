import type { SFSymbol } from "expo-symbols";

/**
 * Canonical registry for destinations rendered as pseudo-tabs in the native
 * Others menu. Add a key here first; the exhaustive descriptor Records and
 * navigation tests make every other required addition visible.
 */
export const OVERFLOW_TAB_KEYS = ["queue", "wallet", "account", "operations"] as const;

export type OverflowTabKey = (typeof OVERFLOW_TAB_KEYS)[number];

export const OVERFLOW_TAB_ICON: Record<OverflowTabKey, SFSymbol> = {
  queue: "clock",
  wallet: "wallet.pass",
  account: "person.crop.circle",
  operations: "rectangle.3.group",
};

export const OVERFLOW_TAB_ROUTE: Record<OverflowTabKey, `/(tabs)/others/${OverflowTabKey}`> = {
  queue: "/(tabs)/others/queue",
  wallet: "/(tabs)/others/wallet",
  account: "/(tabs)/others/account",
  operations: "/(tabs)/others/operations",
};

export const OVERFLOW_TAB_LABEL_KEY: Record<
  OverflowTabKey,
  "tabQueue" | "tabWallet" | "tabAccount" | "tabQueueOperations"
> = {
  queue: "tabQueue",
  wallet: "tabWallet",
  account: "tabAccount",
  operations: "tabQueueOperations",
};
