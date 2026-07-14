import { Redirect } from "expo-router";
import { authClient } from "@/lib/auth-client";

/** Root route: send to the tabs (if signed in) or sign-in (if not). */
export default function Index() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  return <Redirect href={session ? "/(tabs)/schedule" : "/(auth)/sign-in"} />;
}
