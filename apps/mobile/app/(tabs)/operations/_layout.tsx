import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { nativeStackScreenOptions } from "@/lib/navigation";

export default function OperationsLayout() {
  const { t } = useLocale();
  return (
    <Stack screenOptions={nativeStackScreenOptions}>
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
