import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { useTabStackScreenOptions } from "@/lib/navigation";

export default function OperationsLayout() {
  const stackScreenOptions = useTabStackScreenOptions();
  const { t } = useLocale();
  return (
    <Stack screenOptions={stackScreenOptions}>
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
