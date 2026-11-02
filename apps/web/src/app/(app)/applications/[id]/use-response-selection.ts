"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** H13: response identity belongs in the URL; answers remain local. */
export function useResponseSelection() {
  const responseParam = useSearchParams().get("response");
  const selectedId =
    responseParam && /^[1-9]\d*$/.test(responseParam) && Number.isSafeInteger(Number(responseParam))
      ? Number(responseParam)
      : null;
  const setSelectedId = useCallback((value: number | null) => {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete("response");
    else url.searchParams.set("response", String(value));
    if (url.href !== window.location.href) window.history.replaceState(null, "", url);
  }, []);
  return { selectedId, setSelectedId };
}
