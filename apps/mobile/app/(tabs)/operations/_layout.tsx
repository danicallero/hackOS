import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";
import { Platform } from "react-native";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { useTabStackScreenOptions } from "@/lib/navigation";
import { canOperateQueues } from "@/lib/tabs";

export default function OperationsLayout() {
  const stackScreenOptions = useTabStackScreenOptions();
  const { t } = useLocale();
  const { me } = useMeContext();
  // H8/H55: route registration is not permission to operate queues.
  if (!canOperateQueues(me?.capabilities ?? [])) return <Redirect href="/(tabs)/schedule" />;
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen
        name="index"
        options={{
          headerLargeTitle: Platform.OS === "ios",
          headerTransparent: Platform.OS === "ios",
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
