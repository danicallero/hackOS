import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { isPadIdiom } from "@/lib/tabs";

/**
 * On iPhone every screen here is reached via `router.replace` from the
 * popover in app/(tabs)/_layout.tsx and stays header-less, acting like a
 * flat pseudo-tab (see that file's navigation contract). On iPad/macOS
 * these are reached by pushing from the real hub screen (index) instead —
 * see OthersHubScreen — so they need a title and a working back button.
 * `operations` keeps its own nested Stack/header unconditionally, as it
 * already did before this file drew any iPad/iPhone distinction.
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
      <Stack.Screen name="account" options={{ headerShown, title: t("tabAccount") }} />
      <Stack.Screen name="queue" options={{ headerShown, title: t("tabQueue") }} />
      <Stack.Screen name="wallet" options={{ headerShown, title: t("tabWallet") }} />
    </Stack>
  );
}
