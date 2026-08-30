import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { transparentDetailHeaderOptions } from "@/lib/navigation";
import { isPadIdiom } from "@/lib/tabs";

/**
 * The custom `Others` menu uses `router.replace` for these pseudo-tabs on
 * every platform. Keep compact screens header-less, while regular-width
 * iPad/macOS screens retain a native large-title header. Person detail routes
 * stay in this Stack as well; putting them in a nested person Stack would
 * discard the previous Statistics/history screen from the detail navigator's
 * own history and leave it without a native back action.
 */
export default function OthersLayout() {
  const { t } = useLocale();
  const headerShown = isPadIdiom();

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal", headerShown: false }}>
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
        name="sync-queue"
        options={{ headerShown: true, headerLargeTitle: true, title: t("scannerSyncQueueTitle") }}
      />
      <Stack.Screen
        name="legal"
        options={{ headerShown: true, headerLargeTitle: true, title: t("accountLegalTitle") }}
      />
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
      <Stack.Screen
        name="queue"
        options={{ headerShown, headerLargeTitle: true, title: t("tabQueue") }}
      />
      <Stack.Screen
        name="wallet"
        options={{ headerShown, headerLargeTitle: true, title: t("tabWallet") }}
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
