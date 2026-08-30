import { Stack } from "expo-router/stack";

import { PresenceScreen } from "@/components/presence-screen";
import { transparentDetailHeaderOptions } from "@/lib/navigation";

export default function OthersPresenceRoute() {
  return (
    <>
      <Stack.Screen options={transparentDetailHeaderOptions} />
      <PresenceScreen />
    </>
  );
}
