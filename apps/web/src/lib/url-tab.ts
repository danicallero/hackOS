"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

export interface UrlTabOptions<T extends string> {
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const valuesKey = values.join("\u0000");
  const resolved = resolveUrlTab(requested, { values, defaultValue, aliases });

  // The rendered tab is local state, not `resolved` directly: on a page
  // whose child re-renders constantly (e.g. a live-updating SSE query),
  // those re-renders can preempt the `router.replace` transition below
  // before it commits, so the URL-derived value never visibly changes even
  // though the click fired — the switch just silently loses the race over
  // and over. Local state updates synchronously and can't be starved that
  // way; the URL stays in sync underneath it as a best-effort side channel,
  // and still drives `tab` for back/forward navigation and deep links.
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
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, valuesKey],
  );

  return { tab, setTab, requested };
}
