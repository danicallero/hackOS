import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";

/**
 * Gives the Schedule tab its own native stack so `index.tsx` can drive a real
 * header (large title + integrated search) via `navigation.setOptions`. The
 * bell presents the inbox as a sheet on this stack (H51); notification
 * settings live in Account.
 */
export default function ScheduleLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="alerts"
        options={{
          headerLargeTitle: true,
          headerShadowVisible: false,
          presentation: "modal",
          title: t("tabNotifications"),
        }}
      />
    </Stack>
  );
}
