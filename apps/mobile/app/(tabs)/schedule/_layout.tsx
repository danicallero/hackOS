import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { nativeStackScreenOptions } from "@/lib/navigation";
import { colors } from "@/theme/colors";

/**
 * Gives the Schedule tab its own native stack so `index.tsx` can drive a real
 * header (large title + integrated search) via `navigation.setOptions`. The
 * bell presents the inbox as a sheet on this stack (H51) with an inline title
 * between its toolbar groups; notification settings live in Account.
 */
export default function ScheduleLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={nativeStackScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="alerts"
        options={{
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTitleAlign: "center",
          headerTitleStyle: { color: colors.label, fontSize: 20, fontWeight: "700" },
          presentation: "modal",
          title: t("tabNotifications"),
        }}
      />
    </Stack>
  );
}
