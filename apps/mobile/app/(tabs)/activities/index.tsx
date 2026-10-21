import { useLocalSearchParams } from "expo-router";
import { ActivitiesScreen } from "@/components/activities-screen";
import { parseActivityId } from "@/lib/activity-pane";

export default function ActivitiesRoute() {
  // The scanner route hands its activity back here when the window opens into two panes.
  const { selected, selectedNonce } = useLocalSearchParams<{
    selected?: string;
    selectedNonce?: string;
  }>();
  return <ActivitiesScreen deepLink={{ id: parseActivityId(selected), nonce: selectedNonce }} />;
}
