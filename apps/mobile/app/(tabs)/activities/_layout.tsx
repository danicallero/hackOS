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
          headerLargeTitle: true,
          headerTransparent: true,
          headerShadowVisible: false,
          title: t("scannerPeople"),
          headerSearchBarOptions: {
            placeholder: t("scannerPeopleSearchPlaceholder"),
            autoCapitalize: "none",
            hideWhenScrolling: true,
            placement: "integratedButton",
          },
        }}
      />
      <Stack.Screen name="person" options={{ headerShown: false }} />
    </Stack>
  );
}
