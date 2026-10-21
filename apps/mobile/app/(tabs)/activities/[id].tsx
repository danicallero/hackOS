import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityScannerScreen } from "@/components/activity-scanner-screen";
import { parseActivityId } from "@/lib/activity-pane";
import { useActivityPaneLayout } from "@/theme/layout-activity-pane";

export default function ActivityScannerRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { twoPane } = useActivityPaneLayout();
  // A window wide enough for two panes shows this scanner beside the list instead of on its own
  // screen (deep links, or a fold opened while the scanner was pushed).
  useEffect(() => {
    if (!twoPane) return;
    router.dismissTo({
      pathname: "/activities",
      params: { selected: String(parseActivityId(id) ?? ""), selectedNonce: String(Date.now()) },
    });
  }, [twoPane, id, router]);
  return twoPane ? null : <ActivityScannerScreen />;
}
