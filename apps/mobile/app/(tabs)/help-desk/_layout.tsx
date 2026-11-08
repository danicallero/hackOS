import { Stack } from "expo-router/stack";

import { useTabStackScreenOptions } from "@/lib/navigation";
import { colors } from "@/theme/colors";

/** H61-H67: the Help desk tab owns its stack so request, helper and coverage pages keep the tab selected. */
export default function HelpDeskLayout() {
  const stackScreenOptions = useTabStackScreenOptions();
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="new-request"
        options={{
          headerBlurEffect: "none",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          presentation: "modal",
        }}
      />
    </Stack>
  );
}
