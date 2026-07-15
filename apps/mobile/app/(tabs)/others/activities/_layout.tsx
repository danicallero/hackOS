import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";

export default function ActivitiesLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ title: t("tabActivities"), headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: t("scannerScanActivity"), headerShown: false }} />
      {/*
        "people" and "person" are themselves directories with their own
        nested _layout.tsx (each rendering its own native header). Without
        headerShown: false here, this outer Stack.Screen — which just wraps
        that nested navigator — showed its OWN default header (untranslated
        route name + back button) stacked on top of the inner one.
      */}
      <Stack.Screen name="people" options={{ headerShown: false }} />
      <Stack.Screen name="person" options={{ headerShown: false }} />
    </Stack>
  );
}
