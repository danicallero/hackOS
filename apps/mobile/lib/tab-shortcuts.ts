import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import HardwareShortcuts, { type HardwareShortcut } from "@/modules/hardware-shortcuts";

/** Command+1 ... Command+9 select the nth destination; Command+, opens Account. */
export const MAX_NUMBERED_SHORTCUTS = 9;
export const ACCOUNT_SHORTCUT_INPUT = ",";

/**
 * Shortcut table for the destinations in the order the navigator shows them: direct cells first,
 * then the overflow destinations, so the numbering follows capabilities and the overflow split.
 */
export function tabShortcuts(destinations: readonly string[]): HardwareShortcut[] {
  const numbered = destinations
    .slice(0, MAX_NUMBERED_SHORTCUTS)
    .map((id, index) => ({ id, input: String(index + 1) }));
  const account = destinations.includes("account")
    ? [{ id: "account", input: ACCOUNT_SHORTCUT_INPUT }]
    : [];
  return [...numbered, ...account];
}

/**
 * Registers the Command-key shortcuts for `destinations` and calls `onSelect(id)` when one fires.
 * iOS only (iPad keyboard, Mac Designed for iPad); a no-op without the native module.
 */
export function useTabShortcuts(destinations: readonly string[], onSelect: (id: string) => void) {
  const select = useRef(onSelect);
  select.current = onSelect;
  const signature = destinations.join("|");

  useEffect(() => {
    if (Platform.OS !== "ios" || !HardwareShortcuts) return;
    HardwareShortcuts.setShortcuts(tabShortcuts(signature ? signature.split("|") : []));
    const subscription = HardwareShortcuts.addListener("onShortcut", ({ id }) =>
      select.current(id),
    );
    return () => {
      subscription.remove();
      HardwareShortcuts?.setShortcuts([]);
    };
  }, [signature]);
}
