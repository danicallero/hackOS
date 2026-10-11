import { Stack } from "expo-router/stack";

import { nativeStackScreenOptions } from "@/lib/navigation";

export default function PeopleLayout() {
  return <Stack screenOptions={nativeStackScreenOptions} />;
}
