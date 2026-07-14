import { Redirect, Stack } from "expo-router";
import { authClient } from "@/lib/auth-client";

export default function AuthLayout() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (session) return <Redirect href="/(tabs)/schedule" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
