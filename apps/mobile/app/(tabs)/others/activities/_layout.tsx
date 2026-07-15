import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";

export default function ActivitiesLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ title: t("tabActivities"), headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: t("scannerScanActivity"), headerShown: false }} />
      <Stack.Screen name="people/index" />
      <Stack.Screen name="person" options={{ headerShown: false }} />
    </Stack>
  );
}
