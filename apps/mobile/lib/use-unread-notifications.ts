import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { apiFetch } from "./api";
import { useMeContext } from "./me-context";
import { subscribeToNotificationChanges } from "./notification-events";
import { subscribeToServerEvent } from "./server-events";

interface UnreadInboxResponse {
  total: number;
}

/**
 * H51: the server's unread inbox total for the Schedule bell. Refreshes on
 * inbox changes made in the app, on the personal realtime stream, and on
 * foreground; a transient failure keeps the last known count.
 */
export function useUnreadNotificationCount(): number {
  const { me } = useMeContext();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!me) return;
    try {
      const inbox = await apiFetch<UnreadInboxResponse>(
        "/api/me/notifications?unread=true&limit=1&offset=0",
      );
      setCount(inbox.total);
    } catch {
      // Keep the last known count during a transient connectivity failure.
    }
  }, [me]);

  useEffect(() => {
    if (!me) {
      setCount(0);
      return;
    }
    void refresh();
    const unsubscribeChanges = subscribeToNotificationChanges(() => void refresh());
    const unsubscribeServer = subscribeToServerEvent(EVENTS.USER_NOTIFICATION, () => {
      void refresh();
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      unsubscribeChanges();
      unsubscribeServer();
      appStateSubscription.remove();
    };
  }, [refresh, me]);

  return count;
}
