import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";

import { useColorScheme } from "@/components/useColorScheme";
import { authClient } from "@/lib/auth-client";
import { isSupportedLanguage, LocaleProvider, useLocale } from "@/lib/i18n";
import { MeProvider, useMeContext } from "@/lib/me-context";
import { setupNotificationListeners } from "@/lib/notifications-setup";
import { registerForPushNotifications } from "@/lib/push";
import { startPersonalEventStream } from "@/lib/server-events";

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from "expo-router";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <LocaleProvider>
      <RootLayoutSession />
    </LocaleProvider>
  );
}

function RootLayoutSession() {
  const { data: session } = authClient.useSession();

  return (
    <MeProvider authenticated={Boolean(session)}>
      <LanguageSync />
      <PushRegistration authenticated={Boolean(session)} />
      <NotificationListeners />
      <PersonalEventStream authenticated={Boolean(session)} />
      <RootLayoutNav />
    </MeProvider>
  );
}

/** Push-independent foreground updates for queue and wallet state (H28/H38). */
function PersonalEventStream({ authenticated }: { authenticated: boolean }) {
  useEffect(() => {
    if (!authenticated) return;
    return startPersonalEventStream();
  }, [authenticated]);
  return null;
}

/** Keeps the app's language in sync with the signed-in user's H7 preference. */
function LanguageSync() {
  const { me } = useMeContext();
  const { setLanguage } = useLocale();
  useEffect(() => {
    if (me && isSupportedLanguage(me.language)) setLanguage(me.language);
  }, [me, setLanguage]);
  return null;
}

/** Best-effort Expo push token registration once signed in (H51, H55). */
function PushRegistration({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();
  useEffect(() => {
    if (authenticated && me) {
      registerForPushNotifications().catch(() => {
        // Best-effort: permission denial or a simulator with no push
        // capability shouldn't block using the app.
      });
    }
  }, [authenticated, me]);
  return null;
}

/** Wires notification received/tap listeners for the app's lifetime (H38, H51). */
function NotificationListeners() {
  const router = useRouter();
  useEffect(() => {
    const cleanup = setupNotificationListeners(() => router.push("/(tabs)/queue"));
    return cleanup;
  }, [router]);
  return null;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}
