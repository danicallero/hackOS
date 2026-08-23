import { useFonts } from "expo-font";
import { type Href, useRootNavigationState, useRouter } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";

import { SessionState } from "@/components/session-state";
import { useColorScheme } from "@/components/useColorScheme";
import { authClient, signOut } from "@/lib/auth-client";
import { isSupportedLanguage, LocaleProvider, useLocale } from "@/lib/i18n";
import { MeProvider, useMeContext } from "@/lib/me-context";
import { canEnterMobileApp, isMobileAccessDenied } from "@/lib/mobile-access";
import { setupNotificationListeners } from "@/lib/notifications-setup";
import { registerForPushNotifications } from "@/lib/push";
import { startPersonalEventStream } from "@/lib/server-events";
import { isOperator } from "@/lib/tabs";
import { warmWalletCache } from "@/lib/wallet-cache";
import { colors } from "@/theme/colors";

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
  const initialSessionPending = useInitialSessionPending(isPending);

  return (
    <MeProvider authenticated={Boolean(session)}>
      <LanguageSync />
      <PushRegistration authenticated={Boolean(session)} />
      <WalletCacheWarmup authenticated={Boolean(session)} />
      <NotificationListeners />
      <MobileAccessGate authenticated={Boolean(session)} />
      <PersonalEventStream authenticated={Boolean(session)} />
      <RootLayoutNav authenticated={Boolean(session)} pending={initialSessionPending} />
    </MeProvider>
  );
}

/**
 * Hide routing only for the first Secure Store hydration. Password providers
 * temporarily background the app and can trigger a later session revalidation;
 * unmounting the auth stack then would discard the credentials iOS is filling.
 */
function useInitialSessionPending(pending: boolean) {
  const hasResolved = useRef(!pending);
  const [elapsed, setElapsed] = useState(false);

  if (!pending) hasResolved.current = true;
  const waitingForInitialSession = pending && !hasResolved.current;

  useEffect(() => {
    if (!waitingForInitialSession) {
      setElapsed(false);
      return;
    }
    const timeout = setTimeout(() => setElapsed(true), 3_000);
    return () => clearTimeout(timeout);
  }, [waitingForInitialSession]);

  return waitingForInitialSession && !elapsed;
}

/** Push-independent foreground updates for queue and wallet state (H28/H38). */
function PersonalEventStream({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();
  const enabled = authenticated && me?.mobileAccess === true;
  useEffect(() => {
    if (!enabled) return;
    return startPersonalEventStream();
  }, [enabled]);
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

/** Persist participant ticket details before a later connection outage (H28). */
function WalletCacheWarmup({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();

  useEffect(() => {
    if (!authenticated || !me?.mobileAccess) return;
    void warmWalletCache(me.id);
  }, [authenticated, me?.id, me?.mobileAccess]);

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
  const queueRouteRef = useRef<Href>(queueRoute);

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
      router.replace({
        pathname: "/(auth)/sign-in",
        params: { accessDenied: "1" },
      });
    });
  }, [authenticated, loading, me, router]);

  return null;
}

function RootLayoutNav({ authenticated, pending }: { authenticated: boolean; pending: boolean }) {
  const colorScheme = useColorScheme();
  const { t } = useLocale();
  const { me, loading: meLoading, refetch } = useMeContext();
  const showRestoringSession = useDelayedVisibility(authenticated && !me && meLoading, 500);
  const canEnterApp = canEnterMobileApp(authenticated, me?.mobileAccess);

  // Keep one navigator in charge of session transitions. Protected screens
  // are removed from navigation history when their guard changes, so signing
  // out cannot leave a stale tabs route underneath (or add a second sign-in
  // route while a nested redirect is already running).
  if (pending) return null;

  // Keep an authenticated H4 session recoverable when /api/me is temporarily
  // unavailable or the server has revoked it, instead of leaving a blank tab
  // navigator with no retry or sign-out path.
  if (authenticated && !me) {
    // Most profile restores complete in a fraction of a second. Keep the
    // neutral app surface during that grace period instead of flashing a
    // transient status screen between the splash screen and the app.
    if (meLoading && !showRestoringSession) {
      return <View style={{ backgroundColor: colors.background, flex: 1 }} />;
    }
    return <SessionState loading={meLoading} onRetry={() => void refetch()} />;
  }

  // Access is part of the navigation guard, not just an asynchronous sign-out
  // side effect. This prevents an ineligible account from mounting any event
  // screen during the frame(s) before MobileAccessGate revokes its session.
  if (isMobileAccessDenied(authenticated, me?.mobileAccess)) {
    return <View style={{ backgroundColor: colors.background, flex: 1 }} />;
  }

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Protected guard={!authenticated}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={canEnterApp}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="schedule/[id]"
            options={{
              // Android uses the native compact app bar; iOS keeps its
              // existing transparent large-title presentation (H59).
              headerShown: process.env.EXPO_OS === "ios" || process.env.EXPO_OS === "android",
              headerTransparent: process.env.EXPO_OS === "ios",
              headerLargeTitle: process.env.EXPO_OS === "ios",
              headerShadowVisible: process.env.EXPO_OS === "android" ? false : undefined,
              headerBackTitle: t("tabSchedule"),
            }}
          />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

function useDelayedVisibility(active: boolean, delayMs: number) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timeout = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timeout);
  }, [active, delayMs]);

  return visible;
}
