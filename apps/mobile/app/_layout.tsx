import { useFonts } from "expo-font";
import { useRootNavigationState, useRouter } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

import { useColorScheme } from "@/components/useColorScheme";
import { authClient, signOut } from "@/lib/auth-client";
import { isSupportedLanguage, LocaleProvider, useLocale } from "@/lib/i18n";
import { MeProvider, useMeContext } from "@/lib/me-context";
import { setupNotificationListeners } from "@/lib/notifications-setup";
import { registerForPushNotifications } from "@/lib/push";
import { startPersonalEventStream } from "@/lib/server-events";
import { isOperator } from "@/lib/tabs";

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LocaleProvider>
        <RootLayoutSession />
      </LocaleProvider>
    </GestureHandlerRootView>
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
      <MobileAccessGate authenticated={Boolean(session)} />
      <PersonalEventStream authenticated={Boolean(session)} />
      <RootLayoutNav authenticated={Boolean(session)} pending={isPending && !pendingGraceElapsed} />
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

/** Best-effort Expo push token registration once an eligible user signs in. */
function PushRegistration({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();
  useEffect(() => {
    if (authenticated && me?.mobileAccess) {
      registerForPushNotifications().catch(() => {
        // Permission denial and simulators without push must not block the app.
      });
    }
  }, [authenticated, me]);
  return null;
}

/** Routes queue-notification taps after the native navigator is ready. */
function NotificationListeners() {
  const router = useRouter();
  const { me } = useMeContext();
  const navigationState = useRootNavigationState();
  const isReady = useRef(false);
  const pendingNavigation = useRef(false);
  const navigationReady = Boolean(navigationState?.key);
  const queueRoute = isOperator(me?.capabilities ?? []) ? "/(tabs)/others/queue" : "/(tabs)/queue";
  const queueRouteRef = useRef(queueRoute);

  isReady.current = navigationReady;
  queueRouteRef.current = queueRoute;

  useEffect(() => {
    if (pendingNavigation.current && navigationReady) {
      pendingNavigation.current = false;
      router.push(queueRouteRef.current);
    }
  }, [navigationReady, router]);

  useEffect(
    () =>
      setupNotificationListeners(() => {
        if (isReady.current) router.push(queueRouteRef.current);
        else pendingNavigation.current = true;
      }),
    [router],
  );

  return null;
}

/** Signs ordinary applicants back out before they can enter event-day routes. */
function MobileAccessGate({ authenticated }: { authenticated: boolean }) {
  const { me, loading } = useMeContext();
  const router = useRouter();
  useEffect(() => {
    if (!authenticated || loading || !me || me.mobileAccess) return;
    void signOut().finally(() => {
      router.replace({ pathname: "/(auth)/sign-in", params: { accessDenied: "1" } });
    });
  }, [authenticated, loading, me, router]);

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
