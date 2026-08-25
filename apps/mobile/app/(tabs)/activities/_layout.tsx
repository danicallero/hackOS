import { Stack } from "expo-router/stack";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export default function ActivitiesLayout() {
  const { t } = useLocale();
  const glassAvailable = isRealLiquidGlassAvailable();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen
        name="index"
        options={{
          // Match Schedule: the real iOS 26 header owns the search button and
          // the toolbar material; the screen supplies the fallback elsewhere.
          headerShown: glassAvailable,
          headerStyle: { backgroundColor: colors.background },
          title: t("tabActivities"),
        }}
      />
      <Stack.Screen
        name="[id]"
        options={{
          title: t("scannerScanActivity"),
          headerShown: process.env.EXPO_OS === "ios",
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: "",
          headerTintColor: "white",
          headerBackVisible: false,
        }}
      />
      <Stack.Screen
        name="people/index"
        options={{
          // Android has no large-title app bar and no `contentInset`
          // adjustment, so a transparent header there just floats over the
          // list's first rows — keep the native opaque app bar (H59).
          headerShown: glassAvailable,
          headerLargeTitle: process.env.EXPO_OS === "ios",
          // Large titles start left-aligned and collapse to the centred
          // compact title as People scrolls; automatic list insets keep the
          // first row below the title while the header remains transparent.
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
      {/* Kept as a direct child of this Stack (not a nested one) so the
          detail route shares the same navigation chrome as `[id]` above.
          A second Stack would create a duplicate native header. */}
      <Stack.Screen
        name="person/[id]"
        options={{
          headerShown: process.env.EXPO_OS === "ios",
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: "",
          headerBackVisible: false,
        }}
      />
    </Stack>
  );
}
