import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { isPadIdiom } from "@/lib/tabs";

/**
 * On iPhone every screen here is reached via `router.replace` from the
 * popover in app/(tabs)/_layout.tsx and stays header-less, acting like a
 * flat pseudo-tab (see that file's navigation contract). On iPad/macOS
 * these are reached by pushing from the real hub screen (index — see
 * OthersHubScreen) instead, so they get a header — `headerLargeTitle: true`
 * matters here, not just cosmetically: without it iOS renders a solid
 * compact bar as its own row underneath NativeTabs' floating top bar (a
 * visible double bar). With it, the compact chrome collapses into
 * NativeTabs' own row (back chevron at its leading edge) and the title
 * becomes a plain heading underneath, the same native pattern already used
 * by app/(tabs)/scan/people (see PeopleDirectoryScreen's
 * `navigation.setOptions({ headerLargeTitle: true, ... })`).
 * `operations` keeps its own nested Stack/header, unrelated to this file.
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
    </Stack>
  );
}
