import { Stack } from "expo-router/stack";

import { useLocale } from "@/lib/i18n";

export default function ActivitiesLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ title: t("tabActivities"), headerLargeTitle: true }} />
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
          headerLargeTitle: process.env.EXPO_OS === "ios",
          headerTransparent: process.env.EXPO_OS === "ios",
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
