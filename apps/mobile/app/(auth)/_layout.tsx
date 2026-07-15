import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";

export default function AuthLayout() {
  const { t } = useLocale();
  const { data: session, isPending } = authClient.useSession();
  const { loading } = useMeContext();
  const pendingGraceElapsed = usePendingGrace(isPending);
  if (isPending && !pendingGraceElapsed) return null;
  if (session && loading) return null;
  if (session) {
    return <Redirect href="/(tabs)/schedule" />;
  }

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ title: t("resetPassword") }} />
      <Stack.Screen name="reset-password" options={{ title: t("setNewPassword") }} />
    </Stack>
  );
}

function usePendingGrace(pending: boolean) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!pending) {
      setElapsed(false);
      return;
    }
    const timeout = setTimeout(() => setElapsed(true), 3_000);
    return () => clearTimeout(timeout);
  }, [pending]);
  return elapsed;
}
