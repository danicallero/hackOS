import { Stack } from "expo-router/stack";
import { Platform } from "react-native";
import { useLocale } from "@/lib/i18n";
import { nativeStackScreenOptions, transparentDetailHeaderOptions } from "@/lib/navigation";
import { isPadIdiom } from "@/lib/tabs";

/**
 * The custom `Others` menu uses `router.replace` for these pseudo-tabs on
 * every platform. Keep compact screens header-less, while regular-width
 * iPad/macOS screens retain a native large-title header. Person detail routes
 * stay in this Stack as well; putting them in a nested person Stack would
 * discard the previous Statistics/history screen from the detail navigator's
 * own history and leave it without a native back action.
 */
const compactHeaderOptions = {
  headerShown: true,
  headerLargeTitle: false,
  headerShadowVisible: false,
  headerTransparent: Platform.OS === "ios",
} as const;

export default function OthersLayout() {
  const { t } = useLocale();
  const headerShown = isPadIdiom();

  return (
    <Stack screenOptions={{ ...nativeStackScreenOptions, headerShown: false }}>
      <Stack.Screen
        name="index"
        options={{ headerShown, headerLargeTitle: true, title: t("tabOthers") }}
      />
      <Stack.Screen
        name="account"
        options={{ headerShown, headerLargeTitle: true, title: t("tabAccount") }}
      />
      <Stack.Screen
        name="storage"
        options={{ headerShown: true, headerLargeTitle: true, title: t("storageTitle") }}
      />
      <Stack.Screen
        name="statistics"
        options={{ headerShown: true, headerLargeTitle: true, title: t("accountStatistics") }}
      />
      <Stack.Screen
        name="stands"
        options={{ headerShown: true, headerLargeTitle: true, title: t("standsTitle") }}
      />
      <Stack.Screen
        name="stand/[id]"
        options={{ headerShown: true, headerLargeTitle: true, title: "" }}
      />
      <Stack.Screen
        name="sync-queue"
        options={{ headerShown: true, headerLargeTitle: true, title: t("scannerSyncQueueTitle") }}
      />
      <Stack.Screen
        name="notification-settings/index"
        options={{ headerShown: true, headerLargeTitle: true, title: t("alertsNotifications") }}
      />
      <Stack.Screen
        name="notification-settings/live-activities"
        options={{ headerShown: true, headerLargeTitle: true }}
      />
      <Stack.Screen
        name="notification-settings/[category]"
        options={{ headerShown: true, headerLargeTitle: true }}
      />
      <Stack.Screen
        name="reminders/[kind]"
        options={{ headerShown: true, headerLargeTitle: true }}
      />
      <Stack.Screen
        name="announcements"
        options={{
          headerShown: true,
          headerLargeTitle: true,
          title: t("notificationsAnnouncements"),
        }}
      />
      <Stack.Screen
        name="legal"
        options={{ headerShown: true, headerLargeTitle: true, title: t("accountLegalTitle") }}
      />
      {/* Compact title over the scrolling notices; iOS blurs the scroll edge. */}
      <Stack.Screen
        name="licenses/index"
        options={{ ...compactHeaderOptions, title: t("legalLicenses") }}
      />
      <Stack.Screen name="licenses/[name]" options={compactHeaderOptions} />
      <Stack.Screen name="person/[id]" options={transparentDetailHeaderOptions} />
      <Stack.Screen name="person/presence/[id]" options={transparentDetailHeaderOptions} />
      <Stack.Screen
        name="delete-account"
        options={{
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerShown: true,
          title: t("accountDeleteSection"),
        }}
      />
      <Stack.Screen name="scan-log" />
      {/* Compact title over the scrolling queue, like Open-source licenses; iPad keeps its large title. */}
      <Stack.Screen
        name="queue"
        options={
          headerShown
            ? { headerShown, headerLargeTitle: true, title: t("tabQueue") }
            : { ...compactHeaderOptions, title: t("tabQueue") }
        }
      />
      <Stack.Screen
        name="wallet"
        // Deep links only; Account opens the wallet as an overlay. Back button
        // without a title, so the Ticket/Badge control leads the page (H28).
        options={{
          headerLargeTitle: false,
          headerShadowVisible: false,
          headerShown: true,
          title: "",
        }}
      />
      <Stack.Screen
        name="diary"
        options={{ headerShown, headerLargeTitle: true, title: t("tabDiary") }}
      />
      <Stack.Screen
        name="operations"
        options={{
          headerShown,
          headerLargeTitle: true,
          headerTransparent: true,
          headerShadowVisible: false,
          title: t("tabQueueOperations"),
          headerSearchBarOptions: {
            placeholder: t("queueOpsSearchPlaceholder"),
            autoCapitalize: "none",
            hideWhenScrolling: true,
            allowToolbarIntegration: false,
            placement: "integratedButton",
          },
        }}
      />
      <Stack.Screen name="team" options={{ headerShown, headerLargeTitle: true }} />
    </Stack>
  );
}
