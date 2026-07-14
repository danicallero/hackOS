import { EVENTS } from "@hackos/shared/events";
import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useCallback, useEffect, useState } from "react";
import { AppState, useColorScheme } from "react-native";

import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import { subscribeToServerEvent } from "@/lib/server-events";
import { colors } from "@/theme/colors";

interface UnreadInboxResponse {
  total: number;
}

/**
 * A real platform tab bar. On iOS 26, the final `search` role is rendered by
 * UIKit as the same separate circular Liquid Glass control used by Apple Music.
 */
export default function TabLayout() {
  useColorScheme();
  const { t } = useLocale();
  const { data: session, isPending } = authClient.useSession();
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);

  const refreshUnreadNotifications = useCallback(async () => {
    if (!session) return;
    try {
      const inbox = await apiFetch<UnreadInboxResponse>(
        "/api/me/notifications?unread=true&limit=1&offset=0",
      );
      setHasUnreadNotifications(inbox.total > 0);
    } catch {
      // Keep the last known state during a transient connectivity failure.
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
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
  }, [refreshUnreadNotifications, session]);

  if (isPending) return null;
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <NativeTabs tintColor={colors.accent} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="schedule">
        <NativeTabs.Trigger.Icon
          sf={{ default: "calendar", selected: "calendar.circle.fill" }}
          md="calendar_month"
        />
        <NativeTabs.Trigger.Label>{t("tabSchedule")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="queue">
        <NativeTabs.Trigger.Icon sf={{ default: "clock", selected: "clock.fill" }} md="schedule" />
        <NativeTabs.Trigger.Label>{t("tabQueue")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wallet">
        <NativeTabs.Trigger.Icon
          sf={{ default: "wallet.pass", selected: "wallet.pass.fill" }}
          md="account_balance_wallet"
        />
        <NativeTabs.Trigger.Label>{t("tabWallet")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Icon
          sf={{ default: "bell", selected: "bell.fill" }}
          md="notifications"
        />
        <NativeTabs.Trigger.Label>{t("tabNotifications")}</NativeTabs.Trigger.Label>
        {hasUnreadNotifications ? <NativeTabs.Trigger.Badge /> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="others" role="search" disablePopToTop>
        <NativeTabs.Trigger.Icon sf="ellipsis" md="more_horiz" />
        <NativeTabs.Trigger.Label hidden>{t("tabOthers")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
