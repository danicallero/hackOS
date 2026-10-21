import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { useTabStackScreenOptions } from "@/lib/navigation";
import { colors, type } from "@/theme";

/**
 * Gives the Schedule tab its own native stack so `index.tsx` can drive a real
 * header (large title + integrated search) via `navigation.setOptions`. The
 * bell presents the inbox as a sheet on this stack (H51) with an inline title
 * between its toolbar groups; notification settings live in Account.
 */
export default function ScheduleLayout() {
  const stackScreenOptions = useTabStackScreenOptions();
  const { t } = useLocale();
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="alerts"
        options={{
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTitleAlign: "center",
          headerTitleStyle: {
            color: colors.label,
            fontSize: type.body.fontSize,
            fontWeight: "600",
          },
          presentation: "modal",
          title: t("tabNotifications"),
        }}
      />
    </Stack>
  );
}
