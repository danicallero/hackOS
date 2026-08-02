import { Slot } from "expo-router";
import { Stack } from "expo-router/stack";

import { useLocale } from "@/lib/i18n";
import { isPadIdiom } from "@/lib/tabs";

/**
 * iPad/macOS leaves this route in the parent Others stack so its controls can
 * integrate with the top tab bar. iPhone reaches it as a header-less
 * pseudo-tab, so it still needs its own stack to provide the title and search.
 */
export default function OperationsLayout() {
  const { t } = useLocale();
  if (isPadIdiom()) return <Slot />;

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen
        name="index"
        options={{
          headerLargeTitle: true,
          title: t("tabQueueOperations"),
          headerSearchBarOptions: {
            placeholder: t("queueOpsSearchPlaceholder"),
            autoCapitalize: "none",
            hideWhenScrolling: true,
            allowToolbarIntegration: true,
            placement: "integratedButton",
          },
        }}
      />
    </Stack>
  );
}
