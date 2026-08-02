import { Stack } from "expo-router/stack";

import { useLocale } from "@/lib/i18n";

export default function ScannerLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen
        name="index"
        options={{
          title: t("tabScan"),
          // Keep the camera edge-to-edge while letting iOS place its native
          // directory action alongside the adaptive iPad/macOS tab chrome.
          headerShown: process.env.EXPO_OS === "ios",
          headerTransparent: true,
          headerShadowVisible: false,
          headerTitle: "",
          headerTintColor: "white",
        }}
      />
      <Stack.Screen name="scan-log" />
      <Stack.Screen name="people/index" />
      <Stack.Screen name="person" options={{ headerShown: false }} />
    </Stack>
  );
}
