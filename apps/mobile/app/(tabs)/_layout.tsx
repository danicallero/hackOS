import { Redirect, Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useClientOnlyValue } from "@/components/useClientOnlyValue";
import { useColorScheme } from "@/components/useColorScheme";
import Colors from "@/constants/Colors";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { type TabKey, visibleTabs } from "@/lib/tabs";

/**
 * Capability-driven tabs (H55): the tab bar reflects `me.capabilities`
 * (refetched on foreground, see lib/use-me.ts) instead of a static list, so a
 * permission change made elsewhere shows up here without reinstalling.
 * `href: null` hides a tab from the bar while keeping the route reachable —
 * Expo Router's documented mechanism for conditional tabs.
 */
export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { t } = useLocale();
  const { data: session, isPending } = authClient.useSession();
  const { me } = useMeContext();
  const headerShown = useClientOnlyValue(false, true);

  if (isPending) return null;
  if (!session) return <Redirect href="/(auth)/sign-in" />;

  const shown = new Set(visibleTabs(me?.capabilities ?? []));
  const hideUnless = (key: TabKey) => (shown.has(key) ? undefined : null);

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        headerShown,
      }}
    >
      <Tabs.Screen
        name="schedule"
        options={{
          title: t("tabSchedule"),
          href: hideUnless("schedule"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          title: t("tabQueue"),
          href: hideUnless("queue"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "clock", android: "schedule", web: "schedule" }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: t("tabWallet"),
          href: hideUnless("wallet"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "wallet.pass",
                android: "account_balance_wallet",
                web: "account_balance_wallet",
              }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t("tabNotifications"),
          href: hideUnless("notifications"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "bell", android: "notifications", web: "notifications" }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t("tabScan"),
          href: hideUnless("scan"),
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: "qrcode.viewfinder",
                android: "qr_code_scanner",
                web: "qr_code_scanner",
              }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />
    </Tabs>
  );
}
