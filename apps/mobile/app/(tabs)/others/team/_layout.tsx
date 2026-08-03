import { Slot } from "expo-router";
import { Stack } from "expo-router/stack";

import { isPadIdiom } from "@/lib/tabs";

/**
 * iPad/macOS leaves this route in the parent Others stack so its header
 * integrates with the top tab bar. iPhone reaches it as a header-less
 * pseudo-tab, so it still needs its own stack to provide the title and back.
 */
export default function TeamLayout() {
  if (isPadIdiom()) return <Slot />;

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="[entryId]" options={{ headerLargeTitle: true }} />
    </Stack>
  );
}
