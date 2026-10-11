import { Slot } from "expo-router";
import { Stack } from "expo-router/stack";

import { nativeStackScreenOptions } from "@/lib/navigation";

import { isPadIdiom } from "@/lib/tabs";

/**
 * iPad/macOS leaves this route in the parent Others stack so its regular-width
 * header stays integrated with the parent navigation. Compact devices reach
 * it as a header-less pseudo-tab, so it still needs its own stack to provide
 * the title and back action.
 */
export default function TeamLayout() {
  if (isPadIdiom()) return <Slot />;

  return (
    <Stack screenOptions={nativeStackScreenOptions}>
      <Stack.Screen name="[entryId]" options={{ headerLargeTitle: true }} />
    </Stack>
  );
}
