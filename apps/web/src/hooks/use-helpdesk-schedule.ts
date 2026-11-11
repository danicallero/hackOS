"use client";
import type { HelpdeskSchedule } from "@hackos/shared/help-desk";
import { useEffect } from "react";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const POLL_MS = 60_000;

/**
 * H64: when the help desk accepts new requests. Every reader shares one key, so
 * the editor's saved replacement reaches the Request help action immediately; the
 * read repeats each minute and right after the next opening or closing instant.
 * Only an explicit `open: false` closes: an unread schedule never blocks.
 */
export function useHelpdeskSchedule(enabled = true) {
  const resource = useServerResource(
    ["helpdesk", "schedule"],
    (signal) => api.get<HelpdeskSchedule>("/api/helpdesk/schedule", { signal }),
    { enabled },
  );
  const { reload } = resource;
  const next = resource.data?.nextChangeAt ?? null;
  useEffect(() => {
    if (!enabled) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, POLL_MS);
    const change = next
      ? window.setTimeout(
          reload,
          Math.min(Math.max(Date.parse(next) - Date.now(), 0) + 1000, MAX_TIMEOUT_MS),
        )
      : null;
    return () => {
      window.clearInterval(poll);
      if (change !== null) window.clearTimeout(change);
    };
  }, [enabled, next, reload]);
  return { ...resource, closed: resource.data?.open === false };
}
