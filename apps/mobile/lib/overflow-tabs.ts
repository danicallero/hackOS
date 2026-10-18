import type { SFSymbol } from "expo-symbols";

/**
 * Canonical registry for destinations rendered as pseudo-tabs in the native
 * Others menu. Add a key here first; the exhaustive descriptor Records and
 * navigation tests make every other required addition visible.
 */
export const OVERFLOW_TAB_KEYS = ["queue", "diary", "account", "operations"] as const;

export type OverflowTabKey = (typeof OVERFLOW_TAB_KEYS)[number];

export const OVERFLOW_TAB_ICON: Record<OverflowTabKey, SFSymbol> = {
  queue: "hammer",
  diary: "person.2.crop.square.stack",
  account: "person.crop.circle",
  operations: "rectangle.3.group",
};

export const OVERFLOW_TAB_ROUTE: Record<OverflowTabKey, `/(tabs)/others/${OverflowTabKey}`> = {
  queue: "/(tabs)/others/queue",
  diary: "/(tabs)/others/diary",
  account: "/(tabs)/others/account",
  operations: "/(tabs)/others/operations",
};

export const OVERFLOW_TAB_LABEL_KEY: Record<
  OverflowTabKey,
  "tabQueue" | "tabDiary" | "tabAccount" | "tabQueueOperations"
> = {
  queue: "tabQueue",
  diary: "tabDiary",
  account: "tabAccount",
  operations: "tabQueueOperations",
};

/**
 * H55: Account is the last overflow destination and must sit nearest the
 * bottom edge. SwiftUI `Menu` opened from the bottom bar lists its first
 * action closest to the trigger (the bottom), so iOS takes the reverse of the
 * visual top-to-bottom order; Android renders the array top-to-bottom as is.
 */
export function nativeMenuOrder<T>(ids: readonly T[]): T[] {
  return [...ids].reverse();
}
