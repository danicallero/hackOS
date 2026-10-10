import { Stack } from "expo-router/stack";

/** Gives the Diary tab its own native stack so `index.tsx` can drive a real header (large title + native search) via `navigation.setOptions` (#935). */
export default function DiaryLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
