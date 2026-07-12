"use client";

import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect } from "react";
import { notificationsApi } from "@/lib/notifications";
import { useLiveQuery } from "./use-event-source";

const PERSONAL_STREAM = "/api/queue/me/stream";

/**
 * Marking a notification read doesn't broadcast an SSE event (it would be
 * wasteful — only the reader's own view needs to know), so any other mounted
 * `useUnreadCount()` consumer (the sidebar, while the inbox page is also
 * open) would otherwise miss it until the next real notification arrives.
 * `notifyNotificationsRead()` lets a reader nudge every consumer to refetch
 * immediately after a successful mark-read.
 */
const NOTIFICATIONS_READ_EVENT = "hackos:notifications-read";

export function notifyNotificationsRead(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT));
}

/** Live unread inbox count (H50/H51), for the sidebar's "you have mail" dot. */
export function useUnreadCount(enabled = true): number {
  const fetcher = useCallback(
    () => notificationsApi.listInbox({ unread: true, limit: 1, offset: 0 }),
    [],
  );
  const { data, refetch } = useLiveQuery(fetcher, PERSONAL_STREAM, [EVENTS.USER_NOTIFICATION], {
    enabled,
  });

  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_READ_EVENT, refetch);
    return () => window.removeEventListener(NOTIFICATIONS_READ_EVENT, refetch);
  }, [refetch]);

  return data?.total ?? 0;
}
