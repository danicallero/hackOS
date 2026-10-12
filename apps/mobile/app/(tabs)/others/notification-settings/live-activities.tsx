import { Stack } from "expo-router";
import { LiveActivityKindsScreen } from "@/components/live-activity-kinds-screen";
import { useLocale } from "@/lib/i18n";
import { liveActivityHost } from "@/lib/live-activities/host";

/** #966: the Live Activity kinds this account receives, with their order. */
export default function LiveActivityKindsRoute() {
  const { t } = useLocale();
  return (
    <>
      <Stack.Screen
        options={{
          title: t(liveActivityHost.platform === "android" ? "liveUpdates" : "liveActivities"),
        }}
      />
      <LiveActivityKindsScreen />
    </>
  );
}
