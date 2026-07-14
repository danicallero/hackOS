import { Redirect } from "expo-router";
import { Stack } from "expo-router/stack";

import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";

export default function AuthLayout() {
  const { t } = useLocale();
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (session) return <Redirect href="/(tabs)/schedule" />;

  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ title: t("resetPassword") }} />
      <Stack.Screen name="reset-password" options={{ title: t("setNewPassword") }} />
    </Stack>
  );
}
