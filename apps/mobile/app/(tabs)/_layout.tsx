import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect, useState } from "react";
import { AppState, useColorScheme, View } from "react-native";

import { OpaqueRouterTabs } from "@/components/opaque-router-tabs";
import { apiFetch } from "@/lib/api";
import { useMeContext } from "@/lib/me-context";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import { subscribeToServerEvent } from "@/lib/server-events";

interface UnreadInboxResponse {
  total: number;
}

/**
 * H55: one custom router tab bar on every iOS and Android surface. Five
 * destinations fit directly; `Others` is a separate native menu circle only
 * when the capability-driven navigation set is larger than that budget.
 *
 * The overflow entries are pseudo-tabs, not ordinary stack links. Their
 * replace/no-op contract lives in `OpaqueRouterTabs` and
 * `lib/operations-navigation.ts`, so selecting a different overflow section
 * never accumulates duplicate screens.
 */
export default function TabLayout() {
  useColorScheme();
  const { me, loading: meLoading } = useMeContext();
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const capabilities = me?.capabilities ?? [];

  const refreshUnreadNotifications = useCallback(async () => {
    if (!me) return;
    try {
      const inbox = await apiFetch<UnreadInboxResponse>(
        "/api/me/notifications?unread=true&limit=1&offset=0",
      );
      setHasUnreadNotifications(inbox.total > 0);
    } catch {
      // Keep the last known state during a transient connectivity failure.
    }
  }, [me]);

  useEffect(() => {
    if (!me) {
      setHasUnreadNotifications(false);
      return;
    }
    void refreshUnreadNotifications();
    const unsubscribeChanges = subscribeToNotificationChanges(() => {
      void refreshUnreadNotifications();
    });
    const unsubscribeServer = subscribeToServerEvent(EVENTS.USER_NOTIFICATION, () => {
      void refreshUnreadNotifications();
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshUnreadNotifications();
    });
    return () => {
      unsubscribeChanges();
      unsubscribeServer();
      appStateSubscription.remove();
    };
  }, [refreshUnreadNotifications, me]);

  // Keep the initial loading guard: mounting the router before the profile is
  // known would register a participant tab set and then change it underneath
  // the selected route when capabilities arrive.
  if (meLoading && !me) return null;
  if (!me?.mobileAccess) return null;

  return (
    <View style={{ flex: 1 }}>
      <OpaqueRouterTabs
        accredited={me.badgeId !== null}
        capabilities={capabilities}
        hasQueueItems={me.hasQueueItems}
        hasUnreadNotifications={hasUnreadNotifications}
      />
    </View>
  );
}
