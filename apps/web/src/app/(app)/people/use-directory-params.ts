"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef } from "react";

export interface DirectoryParams {
  q: string;
  challengeId: string;
  cursor: string;
}

export const DIRECTORY_PARAM_KEYS = { q: "q", challengeId: "challenge", cursor: "cursor" } as const;

export function readDirectoryParams(search: URLSearchParams): DirectoryParams {
  const challenge = search.get(DIRECTORY_PARAM_KEYS.challengeId) ?? "";
  return {
    // Trimmed like the field, so a shared link with spaces is already canonical.
    q: (search.get(DIRECTORY_PARAM_KEYS.q) ?? "").trim(),
    challengeId: /^[1-9]\d*$/.test(challenge) ? challenge : "",
    cursor: search.get(DIRECTORY_PARAM_KEYS.cursor) ?? "",
  };
}

/**
 * Search, challenge and cursor live in the URL so a directory view is
 * shareable (#934). The setter is referentially stable and skips writes
 * that leave the query string unchanged (R003).
 */
export function useDirectoryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const navigation = useRef({ router, pathname, search });
  navigation.current = { router, pathname, search };

  const setParams = useCallback((patch: Partial<DirectoryParams>) => {
    const current = navigation.current;
    const params = new URLSearchParams(current.search);
    for (const [field, value] of Object.entries(patch) as [keyof DirectoryParams, string][]) {
      const key = DIRECTORY_PARAM_KEYS[field];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const next = params.toString();
    if (next === current.search) return;
    current.router.replace(next ? `${current.pathname}?${next}` : current.pathname, {
      scroll: false,
    });
  }, []);

  return { params: readDirectoryParams(searchParams), setParams };
}
