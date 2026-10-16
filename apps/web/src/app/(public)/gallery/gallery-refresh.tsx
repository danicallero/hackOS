"use client";

import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { useEventSource } from "@/hooks/use-event-source";

/** H17/H60: re-evaluate server projections after reveals, consent changes and clock boundaries. */
export function GalleryRefresh() {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      router.refresh();
    }, 200);
  }, [router]);
  useEventSource(REALTIME_SCOPES.PUBLIC_CONTENT, {
    events: [EVENTS.DATA_CHANGED],
    onEvent: refresh,
    onResync: refresh,
  });
  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(refreshVisible, 15_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    };
  }, [refresh]);
  return null;
}
