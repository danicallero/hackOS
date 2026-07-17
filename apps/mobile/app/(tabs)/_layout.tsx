import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { EVENTS } from "@hackos/shared/events";
import { useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useCallback, useEffect, useState } from "react";
import { AppState, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import { subscribeToServerEvent } from "@/lib/server-events";
import { shouldUseOverflowMenu } from "@/lib/tabs";
import { colors } from "@/theme/colors";

interface UnreadInboxResponse {
  total: number;
}

interface OperationsMenuItem extends MenuAction {
  id: "account" | "activities";
  label: string;
  route: "/(tabs)/others/account" | "/(tabs)/others/activities";
}

/**
 * A real platform tab bar. Scanning is promoted to a primary tab for any
 * scan-capability holder (H55, issue #187); Account moves into the native
 * overflow control only then, so scanning is never a tap behind an
 * undifferentiated ellipsis during an operator shift.
 */
export default function TabLayout() {
  useColorScheme();
  const { t } = useLocale();
  const { me, loading: meLoading } = useMeContext();
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const capabilities = me?.capabilities ?? [];
  const operatorExperience = shouldUseOverflowMenu(capabilities);
  const canScanActivities = capabilities.includes("*") || capabilities.includes("activity:scan");

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

  if (meLoading) return null;
  if (!me?.mobileAccess) return null;

  return (
    <View style={{ flex: 1 }}>
      {/*
        No blurEffect/tabBarBackgroundColor override here: per
        react-native-screens' own docs, both stop affecting the tab bar
        starting from iOS 26 — the bar's translucent/opaque appearance on
        26+ is entirely OS-controlled, with no supported override in the
        version of react-native-screens this app currently depends on.
      */}
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
        {operatorExperience ? (
          <NativeTabs.Trigger name="scan">
            <NativeTabs.Trigger.Icon sf="qrcode.viewfinder" md="qr_code_scanner" />
            <NativeTabs.Trigger.Label>{t("tabScan")}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ) : null}
        {operatorExperience ? (
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
      {operatorExperience ? <NativeOperationsMenu canScanActivities={canScanActivities} /> : null}
    </View>
  );
}

function NativeOperationsMenu({ canScanActivities }: { canScanActivities: boolean }) {
  const { bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useLocale();
  const router = useRouter();
  const triggerHeight = bottom + 60;
  const triggerWidth = process.env.EXPO_OS === "ios" ? 76 : width / 5;
  const items: OperationsMenuItem[] = [
    {
      id: "account",
      image: "person.crop.circle",
      label: t("tabAccount"),
      route: "/(tabs)/others/account",
      title: t("tabAccount"),
    },
    ...(canScanActivities
      ? [
          {
            id: "activities" as const,
            image: "list.bullet.rectangle" as const,
            label: t("tabActivities"),
            route: "/(tabs)/others/activities" as const,
            title: t("tabActivities"),
          },
        ]
      : []),
  ];

  return (
    <MenuView
      actions={items}
      onPressAction={({ nativeEvent }) => {
        const item = items.find(({ id }) => id === nativeEvent.event);
        if (item) router.replace(item.route);
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
