import { Stack } from "expo-router/stack";

import { useLocale } from "@/lib/i18n";

export default function OperationsLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen
        name="index"
        options={{
          headerLargeTitle: true,
          headerTransparent: true,
          headerShadowVisible: false,
          title: t("tabQueueOperations"),
          headerSearchBarOptions: {
            placeholder: t("queueOpsSearchPlaceholder"),
            autoCapitalize: "none",
            hideWhenScrolling: true,
            allowToolbarIntegration: false,
            placement: "integratedButton",
          },
        }}
      />
    </Stack>
  );
}
