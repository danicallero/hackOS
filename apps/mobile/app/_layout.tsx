import { useFonts } from "expo-font";
import { useRootNavigationState, useRouter } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
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
  const { data: session, isPending } = authClient.useSession();
  const pendingGraceElapsed = usePendingGrace(isPending);

  return (
    <MeProvider authenticated={Boolean(session)}>
      <LanguageSync />
      <PushRegistration authenticated={Boolean(session)} />
      <NotificationListeners />
      <PersonalEventStream authenticated={Boolean(session)} />
      <RootLayoutNav
        authenticated={Boolean(session)}
        pending={isPending && !pendingGraceElapsed}
      />
    </MeProvider>
  );
}

/** Avoid flashing auth UI during restore without allowing storage to block forever. */
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

/**
 * Wires notification received/tap listeners for the app's lifetime (H38, H51).
 *
 * A cold-start tap can fire before the navigator has finished mounting, in
 * which case `router.push` would silently no-op. `useRootNavigationState`
 * reports `undefined` until the navigator is ready, so a pending navigation
 * is stashed in a ref and flushed as soon as it becomes ready.
 */
function NotificationListeners() {
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const isReady = useRef(false);
  const pendingNavigation = useRef(false);

  isReady.current = Boolean(navigationState?.key);

  useEffect(() => {
    if (pendingNavigation.current && isReady.current) {
      pendingNavigation.current = false;
      router.push("/(tabs)/queue");
    }
  }, [navigationState?.key, router]);

  useEffect(() => {
    const cleanup = setupNotificationListeners(() => {
      if (isReady.current) {
        router.push("/(tabs)/queue");
      } else {
        pendingNavigation.current = true;
      }
    });
    return cleanup;
  }, [router]);

  return null;
}

function RootLayoutNav({ authenticated, pending }: { authenticated: boolean; pending: boolean }) {
  const colorScheme = useColorScheme();

  // Keep one navigator in charge of session transitions. Protected screens
  // are removed from navigation history when their guard changes, so signing
  // out cannot leave a stale tabs route underneath (or add a second sign-in
  // route while a nested redirect is already running).
  if (pending) return null;

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Protected guard={!authenticated}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={authenticated}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="schedule/[id]" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
