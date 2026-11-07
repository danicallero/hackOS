import { Stack, useNavigation, useRoute, useRouter } from "expo-router";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import {
  EntryBackToolbar,
  HeaderBackButton,
  hasScreenBelow,
} from "@/components/header-back-button";
import { LiveActivityKindsScreen } from "@/components/live-activity-kinds-screen";
import { useLocale } from "@/lib/i18n";
import { liveActivityHost } from "@/lib/live-activities/host";

/** #966: the Live Activity kinds this account receives, with their order. */
export default function LiveActivityKindsRoute() {
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const route = useRoute();
  const entry = !hasScreenBelow(navigation, route.key);
  const glassAvailable = isRealLiquidGlassAvailable();
  return (
    <>
      <Stack.Screen
        options={{
          ...(entry
            ? glassAvailable
              ? { headerBackVisible: false }
              : {
                  headerLeft: () => (
                    <HeaderBackButton onPress={() => router.replace("/(tabs)/others/account")} />
                  ),
                }
            : {}),
          title: t(liveActivityHost.platform === "android" ? "liveUpdates" : "liveActivities"),
        }}
      />
      <EntryBackToolbar fallback="/(tabs)/others/account" />
      <LiveActivityKindsScreen />
    </>
  );
}
