import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { useTabStackScreenOptions } from "@/lib/navigation";
import { colors } from "@/theme/colors";

/**
 * H16-H21: My Projects owns a native stack like Schedule. The list drives its
 * own header; New project is a modal sheet (Cancel / Create) and the
 * invitation inbox is a pushed list.
 */
export default function QueueLayout() {
  const stackScreenOptions = useTabStackScreenOptions();
  const { t } = useLocale();
  const header = {
    contentStyle: { ...stackScreenOptions.contentStyle, backgroundColor: colors.background },
    headerShadowVisible: false,
  };
  return (
    <Stack
      screenOptions={{
        ...stackScreenOptions,
        contentStyle: { ...stackScreenOptions.contentStyle, backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="new"
        options={{ ...header, presentation: "modal", title: t("projectNewTitle") }}
      />
      <Stack.Screen
        name="invites"
        options={{ ...header, headerLargeTitle: true, title: t("projectInvitations") }}
      />
    </Stack>
  );
}
