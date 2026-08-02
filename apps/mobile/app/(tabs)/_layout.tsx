import { type MenuAction, type MenuComponentRef, MenuView } from "@expo/ui/community/menu";
import { EVENTS } from "@hackos/shared/events";
import { usePathname, useRouter } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import { resolveOperationsNavigationAction } from "@/lib/operations-navigation";
import {
  OVERFLOW_TAB_ICON,
  OVERFLOW_TAB_LABEL_KEY,
  OVERFLOW_TAB_ROUTE,
  type OverflowTabKey,
} from "@/lib/overflow-tabs";
import { subscribeToServerEvent } from "@/lib/server-events";
import {
  canOperateQueues,
  canScanActivities,
  isOperator,
  isPadIdiom,
  queueOperationsInPrimaryBar,
  shouldUseOverflowMenu,
} from "@/lib/tabs";
import { colors } from "@/theme/colors";

interface UnreadInboxResponse {
  total: number;
}

interface OperationsMenuItem extends MenuAction {
  id: OverflowTabKey;
  label: string;
  route: (typeof OVERFLOW_TAB_ROUTE)[OverflowTabKey];
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
 *
 * That popover contract is iPhone-only. On iPad — and this same build
 * "Designed for iPad" on a Mac — `NativeTabs` relocates to a top-anchored
 * bar whose on-screen geometry this app has no supported way to query, so
 * the popover's bottom-anchored overlay is skipped there (see
 * `overflowAsBottomBarPopover`) and "Others" behaves as an ordinary tab
 * that opens a real hub screen (app/(tabs)/others/index.tsx).
 */
export default function TabLayout() {
  useColorScheme();
  const { t } = useLocale();
  const { me, loading: meLoading } = useMeContext();
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const capabilities = me?.capabilities ?? [];
  const operatorExperience = shouldUseOverflowMenu(capabilities);
  const scannerExperience = isOperator(capabilities);
  const activitiesVisible = canScanActivities(capabilities);
  const queueOperationsVisible = canOperateQueues(capabilities);
  const queueOperationsPrimary = queueOperationsInPrimaryBar(capabilities);
  // iPad (and this same build "Designed for iPad" on a Mac) moves NativeTabs
  // to a top-anchored bar whose geometry JS can't know — see isPadIdiom's
  // doc comment. The bottom-anchored popover overlay below only makes sense
  // against iPhone's fixed bottom bar, so on that idiom "others" is left as
  // a real tab: it navigates to a genuine hub screen instead (app/(tabs)/others/index.tsx).
  const overflowAsBottomBarPopover = operatorExperience && !isPadIdiom();

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

  // Only block on `me` being absent, not merely `meLoading`: a foreground
  // revalidation (e.g. AppState flipping through `inactive` when iOS
  // Control Center opens/closes) sets `meLoading` again after data already
  // loaded. Unmounting NativeTabs here would reset it to its first
  // registered trigger (Schedule) on every remount, flashing that tab in
  // over whatever the user actually had selected.
  if (meLoading && !me) return null;
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
        <NativeTabs.Trigger name="operations" hidden={!queueOperationsPrimary}>
          <NativeTabs.Trigger.Icon
            sf={{ default: "rectangle.3.group", selected: "rectangle.3.group.fill" }}
            md="dashboard"
          />
          <NativeTabs.Trigger.Label>{t("tabQueueOperations")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="scan" hidden={!scannerExperience}>
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
          // capsule treatment on iOS 18+. On iPhone it's still the same
          // custom overflow menu underneath (NativeOperationsMenu), just
          // visually split off from the rest of the tab bar instead of
          // grouped in with them. On iPad/macOS there's no popover overlay
          // to intercept the tap, so this is a real tab: it navigates to
          // app/(tabs)/others/index.tsx, which renders the hub list instead
          // of redirecting straight to Account.
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
      {overflowAsBottomBarPopover ? (
        <NativeOperationsMenu
          tabCount={activitiesVisible ? 5 : 4}
          showQueueOperations={queueOperationsVisible && !queueOperationsPrimary}
        />
      ) : null}
    </View>
  );
}

function NativeOperationsMenu({
  tabCount,
  showQueueOperations,
}: {
  tabCount: number;
  showQueueOperations: boolean;
}) {
  const { bottom } = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const menuRef = useRef<MenuComponentRef>(null);
  const triggerHeight = bottom + 60;
  const triggerWidth = process.env.EXPO_OS === "ios" ? 76 : width / tabCount;
  const overflowIds: OverflowTabKey[] = [
    "queue",
    "wallet",
    "account",
    ...(showQueueOperations ? (["operations"] as const) : []),
  ];
  const items: OperationsMenuItem[] = overflowIds.map((id) => ({
    id,
    image: OVERFLOW_TAB_ICON[id],
    label: t(OVERFLOW_TAB_LABEL_KEY[id]),
    route: OVERFLOW_TAB_ROUTE[id],
    title: t(OVERFLOW_TAB_LABEL_KEY[id]),
  }));

  return (
    <>
      <MenuView
        ref={menuRef}
        actions={items}
        onPressAction={({ nativeEvent }) => {
          const item = items.find(({ id }) => id === nativeEvent.event);
          if (!item) return;
          const action = resolveOperationsNavigationAction(pathname, item.route);
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
          accessible={Platform.OS !== "android"}
          accessibilityLabel={t("tabOthers")}
          accessibilityRole="button"
          style={{
            backgroundColor: colors.invisibleHitTarget,
            height: triggerHeight,
            width: triggerWidth,
          }}
        />
      </MenuView>
      {Platform.OS === "android" ? (
        // The tap target above lives inside `MenuView`'s Jetpack Compose
        // interop tree (`Host matchContents` -> `RNHostView` -> `Pressable`),
        // which intermittently drops the very first touch on Android before
        // the interop bridge finishes attaching — the popup silently fails
        // to open. A plain RN `Pressable` gets reliable touch delivery and
        // opens the same menu through its documented imperative `ref.show()`
        // escape hatch instead of depending on the Compose-hosted tap.
        <Pressable
          accessibilityLabel={t("tabOthers")}
          accessibilityRole="button"
          onPress={() => menuRef.current?.show()}
          style={{
            bottom: 0,
            height: triggerHeight,
            position: "absolute",
            right: 0,
            width: triggerWidth,
            zIndex: 3,
          }}
        />
      ) : null}
    </>
  );
}
