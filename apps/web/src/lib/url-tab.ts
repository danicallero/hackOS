"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

interface UrlTabOptions<T extends string> {
  values: readonly T[];
  defaultValue: T;
  /** Legacy values remain valid deep links while the UI uses the new grouping. */
  aliases?: Partial<Record<string, T>>;
}

export function resolveUrlTab<T extends string>(
  requested: string | null,
  options: Pick<UrlTabOptions<T>, "values" | "defaultValue" | "aliases">,
): T {
  if (requested && options.values.includes(requested as T)) return requested as T;
  if (requested && options.aliases?.[requested]) return options.aliases[requested] as T;
  return options.defaultValue;
}

/**
 * Keeps peer views shareable without making the tab control own navigation.
 * Invalid values render the safe default and are left in the URL so an old
 * bookmark remains inspectable; the next explicit selection writes the
 * canonical value (UX-03, H8/H55).
 */
export function useUrlTab<T extends string>({ values, defaultValue, aliases }: UrlTabOptions<T>) {
  const requested = useSearchParams().get("tab");
  const valuesKey = values.join("\u0000");
  const resolved = resolveUrlTab(requested, { values, defaultValue, aliases });

  // Commit the selection immediately while Next synchronizes useSearchParams.
  const [tab, setTabState] = useState<T>(resolved);
  // Adjust state during render (React's documented alternative to an effect
  // for "reset state when a prop changes"): catches external URL changes —
  // back/forward, a pasted link — without the extra render tick a useEffect
  // reset would add, which would reopen a window for the same race.
  const [trackedResolved, setTrackedResolved] = useState(resolved);
  if (resolved !== trackedResolved) {
    setTrackedResolved(resolved);
    setTabState(resolved);
  }

  const setTab = useCallback(
    (next: string) => {
      if (!valuesKey.split("\u0000").includes(next)) return;
      setTabState(next as T);
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") === next) return;
      url.searchParams.set("tab", next);
      // Peer panels already live on this route (H55). A router navigation would
      // request a new server payload just to synchronize the query string.
      window.history.replaceState(null, "", url);
    },
    [valuesKey],
  );

  return { tab, setTab, requested };
}
