import { Redirect } from "expo-router";

/** Authenticated root route; the root layout owns the session guard. */
export default function Index() {
  return <Redirect href="/(tabs)/schedule" />;
}
