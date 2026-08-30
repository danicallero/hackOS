import { Stack } from "expo-router/stack";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { useLocale } from "@/lib/i18n";
import { transparentDetailHeaderOptions } from "@/lib/navigation";

export default function ScannerLayout() {
  const { t } = useLocale();
  const glassAvailable = isRealLiquidGlassAvailable();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen
        name="index"
        options={{
          title: t("tabScan"),
          // Keep the camera edge-to-edge while letting iOS place its native
          // directory action alongside the regular-width navigation chrome.
          headerShown: glassAvailable,
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: "",
          headerTintColor: "white",
        }}
      />
      <Stack.Screen name="scan-log" />
      <Stack.Screen
        name="people/index"
        options={{
          // Android has no large-title app bar and no `contentInset`
          // adjustment, so a transparent header there just floats over the
          // list's first rows — keep the native opaque app bar (H59).
          headerShown: glassAvailable,
          headerLargeTitle: process.env.EXPO_OS === "ios",
          // Keep the native large-title collapse (left at rest, centred when
          // the list scrolls) while reserving the header's height for rows.
          headerTransparent: true,
          headerShadowVisible: false,
          title: t("scannerPeople"),
          headerSearchBarOptions: {
            placeholder: t("scannerPeopleSearchPlaceholder"),
            autoCapitalize: "none",
            hideWhenScrolling: true,
            allowToolbarIntegration: false,
            placement: "integratedButton",
          },
        }}
      />
      {/* Keep detail routes in this Stack so the native Back action stays
          attached to the scanner flow. The shared screens provide content;
          the transparent native header provides navigation only. */}
      <Stack.Screen name="person/[id]" options={transparentDetailHeaderOptions} />
      <Stack.Screen name="person/presence/[id]" options={transparentDetailHeaderOptions} />
    </Stack>
  );
}
