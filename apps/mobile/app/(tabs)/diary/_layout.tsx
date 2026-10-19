import { Stack } from "expo-router/stack";

import { useTabStackScreenOptions } from "@/lib/navigation";

/** Gives the Diary tab its own native stack so `index.tsx` can drive a real header (large title + native search) via `navigation.setOptions` (#935). */
export default function DiaryLayout() {
  const stackScreenOptions = useTabStackScreenOptions();
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
