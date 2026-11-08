import { Stack } from "expo-router/stack";

import {
  helpSheetOptions,
  transparentDetailHeaderOptions,
  useTabStackScreenOptions,
} from "@/lib/navigation";

/** H61-H67: the Help desk tab owns its stack so request, helper and coverage pages keep the tab selected. */
export default function HelpDeskLayout() {
  const stackScreenOptions = useTabStackScreenOptions();
  return (
    <Stack screenOptions={stackScreenOptions}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new-request" options={helpSheetOptions} />
      <Stack.Screen name="helper/[id]" options={transparentDetailHeaderOptions} />
      <Stack.Screen name="requester/[id]" options={transparentDetailHeaderOptions} />
    </Stack>
  );
}
