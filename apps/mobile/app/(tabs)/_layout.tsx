import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { EVENTS } from "@hackos/shared/events";
import { Redirect, useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useCallback, useEffect, useState } from "react";
import { AppState, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import { subscribeToServerEvent } from "@/lib/server-events";
import { overflowTabs, shouldUseOverflowMenu } from "@/lib/tabs";
import { colors } from "@/theme/colors";

interface UnreadInboxResponse {
  total: number;
}

interface OverflowMenuItem extends MenuAction {
  id: "account" | "scan";
  label: string;
  route: "/(tabs)/others/account" | "/(tabs)/others/scan";
}

/**
 * A real platform tab bar. Users with five destinations get five regular tabs.
 * When a sixth destination is available, the final `search` role becomes the
 * native overflow selector (and uses iOS 26's separate Liquid Glass control).
 */
export default function TabLayout() {
  useColorScheme();
  const { t } = useLocale();
  const { data: session, isPending } = authClient.useSession();
  const { me } = useMeContext();
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const capabilities = me?.capabilities ?? [];
  const usesOverflowMenu = shouldUseOverflowMenu(capabilities);

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
    <View style={{ flex: 1 }}>
      <NativeTabs tintColor={colors.accent} minimizeBehavior="onScrollDown">
        <NativeTabs.Trigger name="schedule">
          <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
          <NativeTabs.Trigger.Label>{t("tabSchedule")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="queue">
          <NativeTabs.Trigger.Icon
            sf={{ default: "clock", selected: "clock.fill" }}
            md="schedule"
          />
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
            sf={
              hasUnreadNotifications
                ? { default: "bell.badge", selected: "bell.badge.fill" }
                : { default: "bell", selected: "bell.fill" }
            }
            md={hasUnreadNotifications ? "notifications_active" : "notifications"}
          />
          <NativeTabs.Trigger.Label>{t("tabNotifications")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        {usesOverflowMenu ? (
          <NativeTabs.Trigger name="others" role="search">
            <NativeTabs.Trigger.Icon sf="ellipsis" md="more_horiz" />
            <NativeTabs.Trigger.Label hidden>{t("tabOthers")}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ) : (
          <NativeTabs.Trigger name="others">
            <NativeTabs.Trigger.Icon
              sf={{ default: "person.crop.circle", selected: "person.crop.circle.fill" }}
              md="account_circle"
            />
            <NativeTabs.Trigger.Label>{t("tabAccount")}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        )}
      </NativeTabs>
      {usesOverflowMenu ? <NativeOthersMenu capabilities={capabilities} /> : null}
    </View>
  );
}

function NativeOthersMenu({ capabilities }: { capabilities: string[] }) {
  const { bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useLocale();
  const router = useRouter();
  const triggerHeight = bottom + 60;
  const triggerWidth = process.env.EXPO_OS === "ios" ? 76 : width / 5;
  const items = overflowTabs(capabilities).flatMap<OverflowMenuItem>((tab) => {
    if (tab === "account") {
      return [
        {
          id: "account",
          image: "person.crop.circle",
          label: t("tabAccount"),
          route: "/(tabs)/others/account" as const,
          title: t("tabAccount"),
        },
      ];
    }
    if (tab === "scan") {
      return [
        {
          id: "scan",
          image: "qrcode.viewfinder",
          label: t("tabScan"),
          route: "/(tabs)/others/scan" as const,
          title: t("tabScan"),
        },
      ];
    }
    return [];
  });

  return (
    <MenuView
      actions={items}
      onPressAction={({ nativeEvent }) => {
        const item = items.find(({ id }) => id === nativeEvent.event);
        if (item) router.navigate(item.route);
      }}
      style={{
        bottom: 0,
        height: triggerHeight,
        position: "absolute",
        right: 0,
        width: triggerWidth,
        zIndex: 2,
      }}
      testID="others-native-menu"
    >
      <View
        accessible
        accessibilityLabel={t("tabOthers")}
        accessibilityRole="button"
        style={{
          backgroundColor: colors.invisibleHitTarget,
          height: triggerHeight,
          width: triggerWidth,
        }}
      />
    </MenuView>
  );
}
