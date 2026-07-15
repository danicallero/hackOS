import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";

export default function ScannerLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ title: t("tabScan"), headerShown: false }} />
      <Stack.Screen name="people" options={{ headerLargeTitle: false }} />
      <Stack.Screen name="person/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
