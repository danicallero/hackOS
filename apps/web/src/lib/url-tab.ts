"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

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
  const tab = resolveUrlTab(requested, { values, defaultValue, aliases });

  const setTab = useCallback(
    (next: string) => {
      if (!valuesKey.split("\u0000").includes(next)) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, valuesKey],
  );

  return { tab, setTab, requested };
}
