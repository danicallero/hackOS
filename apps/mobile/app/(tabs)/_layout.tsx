import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { EVENTS } from "@hackos/shared/events";
import { usePathname, useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useCallback, useEffect, useState } from "react";
import { AppState, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import {
  type OperationsRoute,
  resolveOperationsNavigationAction,
} from "@/lib/operations-navigation";
import { subscribeToServerEvent } from "@/lib/server-events";
import { canScanActivities, shouldUseOverflowMenu } from "@/lib/tabs";
import { colors } from "@/theme/colors";

interface UnreadInboxResponse {
  total: number;
}

interface OperationsMenuItem extends MenuAction {
  id: "account" | "queue" | "wallet";
  label: string;
  route: "/(tabs)/others/account" | "/(tabs)/others/queue" | "/(tabs)/others/wallet";
}

/**
 * A real platform tab bar. A native `UITabBarController` silently collapses
 * anything past its fifth item into iOS's own "More" screen — which bypasses
 * our custom overflow menu entirely. Participants keep their personal tabs;
 * operators prioritize Scanner and Activities while Queue, Wallet, and Account
 * move behind the overflow control.
 *
 * Important navigation contract:
 * - The overflow entries are pseudo-tabs, not ordinary stack links.
 * - Tapping the current pseudo-tab must be a no-op.
 * - Tapping a different pseudo-tab should behave like a tab switch, not
 *   accumulate duplicate screens.
 * - The first entry from Account may push a section stack on top of profile;
 *   once inside a pseudo-tab, subsequent taps should navigate within that
 *   section instead of re-pushing it.
 *
 * Keep this behavior documented and tested. Earlier versions regressed by
 * treating the overflow menu as a plain stack launcher, which duplicated
 * overflow pages and broke back behavior.
 */
export default function TabLayout() {
  useColorScheme();
  const { t } = useLocale();
  const { me, loading: meLoading } = useMeContext();
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const capabilities = me?.capabilities ?? [];
  const operatorExperience = shouldUseOverflowMenu(capabilities);
  const activitiesVisible = canScanActivities(capabilities);

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
        <NativeTabs.Trigger name="queue" hidden={operatorExperience}>
          <NativeTabs.Trigger.Icon
            sf={{ default: "clock", selected: "clock.fill" }}
            md="schedule"
          />
          <NativeTabs.Trigger.Label>{t("tabQueue")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="wallet" hidden={operatorExperience}>
          <NativeTabs.Trigger.Icon
            sf={{ default: "wallet.pass", selected: "wallet.pass.fill" }}
            md="account_balance_wallet"
          />
          <NativeTabs.Trigger.Label>{t("tabWallet")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="scan" hidden={!operatorExperience}>
          <NativeTabs.Trigger.Icon sf="qrcode.viewfinder" md="qr_code_scanner" />
          <NativeTabs.Trigger.Label>{t("tabScan")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="activities" hidden={!activitiesVisible}>
          <NativeTabs.Trigger.Icon
            sf={{ default: "list.bullet.rectangle", selected: "list.bullet.rectangle.fill" }}
            md="event_list"
          />
          <NativeTabs.Trigger.Label>{t("tabActivities")}</NativeTabs.Trigger.Label>
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
          // `role="search"` is what gives this item the separated Liquid Glass
          // capsule treatment on iOS 18+ — it's still the same custom overflow
          // menu underneath (NativeOperationsMenu), just visually split off
          // from the rest of the tab bar instead of grouped in with them.
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
      {operatorExperience ? <NativeOperationsMenu tabCount={activitiesVisible ? 5 : 4} /> : null}
    </View>
  );
}

function NativeOperationsMenu({ tabCount }: { tabCount: number }) {
  const { bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const triggerHeight = bottom + 60;
  const triggerWidth = process.env.EXPO_OS === "ios" ? 76 : width / tabCount;
  const items: OperationsMenuItem[] = [
    {
      id: "queue",
      image: "clock",
      label: t("tabQueue"),
      route: "/(tabs)/others/queue",
      title: t("tabQueue"),
    },
    {
      id: "wallet",
      image: "wallet.pass",
      label: t("tabWallet"),
      route: "/(tabs)/others/wallet",
      title: t("tabWallet"),
    },
    {
      id: "account",
      image: "person.crop.circle",
      label: t("tabAccount"),
      route: "/(tabs)/others/account",
      title: t("tabAccount"),
    },
  ];

  return (
    <MenuView
      actions={items}
      onPressAction={({ nativeEvent }) => {
        const item = items.find(({ id }) => id === nativeEvent.event);
        if (!item) return;
        const action = resolveOperationsNavigationAction(pathname, item.route as OperationsRoute);
        if (action === "noop") return;
        router.replace(item.route);
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
