import { Stack } from "expo-router/stack";

import { PersonOperationsScreen } from "@/components/person-operations-screen";
import { transparentDetailHeaderOptions } from "@/lib/navigation";

export default function ActivitiesPersonRoute() {
  return (
    <>
      <Stack.Screen options={transparentDetailHeaderOptions} />
      <PersonOperationsScreen />
    </>
  );
}
