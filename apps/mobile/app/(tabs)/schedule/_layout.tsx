import { Stack } from "expo-router/stack";

/** Gives the Schedule tab its own native stack so `index.tsx` can drive a real header (large title + integrated search) via `navigation.setOptions`. */
export default function ScheduleLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
