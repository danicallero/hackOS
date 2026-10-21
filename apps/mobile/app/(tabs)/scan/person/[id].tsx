import { useLocalSearchParams, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { useEffect } from "react";
import { Platform, useWindowDimensions } from "react-native";

import { PersonOperationsScreen } from "@/components/person-operations-screen";
import { useBookCrease } from "@/lib/fold-region";
import { transparentDetailHeaderOptions } from "@/lib/navigation";
import { listDetailLayout } from "@/lib/window-size";

export default function ScannerPersonRoute() {
  const router = useRouter();
  const { id, focusLogId, focusSource } = useLocalSearchParams<{
    id: string;
    focusLogId?: string;
    focusSource?: string;
  }>();
  const { width, height } = useWindowDimensions();
  const crease = useBookCrease();
  const twoPane = listDetailLayout(width, height, Platform.OS, crease).enabled;

  // H22: in a two-pane window the profile belongs to the Scanner's right pane, so this route
  // (a deep link, the people list, the history) hands its person to the scanner screen below it.
  useEffect(() => {
    if (!twoPane) return;
    router.dismissTo({
      pathname: "/(tabs)/scan",
      params: { personId: id, focusLogId, focusSource },
    });
  }, [twoPane, router, id, focusLogId, focusSource]);

  if (twoPane) return null;
  return (
    <>
      <Stack.Screen options={transparentDetailHeaderOptions} />
      <PersonOperationsScreen />
    </>
  );
}
