import { Slot } from "expo-router";
import { Stack } from "expo-router/stack";

import { isPadIdiom } from "@/lib/tabs";

export default function TeamLayout() {
  if (isPadIdiom()) return <Slot />;
  return <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }} />;
}
