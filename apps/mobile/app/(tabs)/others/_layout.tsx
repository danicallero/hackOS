import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { isPadIdiom } from "@/lib/tabs";

/**
 * The custom `Others` menu uses `router.replace` for these pseudo-tabs on
 * every platform. Keep compact screens header-less, while regular-width
 * iPad/macOS screens retain a native large-title header. Child detail routes
 * stay in this Stack as well; introducing another Stack would create a second
 * navigation header and break the existing search/header integration.
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
