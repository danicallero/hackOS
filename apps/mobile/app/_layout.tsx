import { EVENTS } from "@hackos/shared/events";
import { useFonts } from "expo-font";
import { type Href, useRootNavigationState, useRouter } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import "react-native-reanimated";

import { PendingRemovalScreen } from "@/components/pending-removal-screen";
import { SessionState } from "@/components/session-state";
import { useColorScheme } from "@/components/useColorScheme";
import { ApiModeProvider, useApiMode } from "@/lib/api-mode";
import { signOut } from "@/lib/auth-client";
import { isSupportedLanguage, LocaleProvider, useLocale } from "@/lib/i18n";
import { MeProvider, useMeContext } from "@/lib/me-context";
import { canEnterMobileApp, isMobileAccessDenied } from "@/lib/mobile-access";
import { setupNotificationListeners } from "@/lib/notifications-setup";
import { registerForPushNotifications } from "@/lib/push";
import {
  startIdentityEventStream,
  startPersonalEventStream,
  subscribeToServerEvent,
} from "@/lib/server-events";
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
        <ApiModeProvider>
          <RootLayoutSession />
        </ApiModeProvider>
      </LocaleProvider>
    </GestureHandlerRootView>
  );
}

function RootLayoutSession() {
  return (
    <MeProvider>
      <RootLayoutSessionContents />
    </MeProvider>
  );
}

function RootLayoutSessionContents() {
  const { me, authenticated, loading, error, offlineEntryAvailable, enterOffline } = useMeContext();
  const { mode } = useApiMode();
  const initialSessionPending = useInitialSessionPending(loading);

  return (
    <View style={{ flex: 1 }}>
      <LanguageSync />
      <PushRegistration authenticated={authenticated} />
      <WalletCacheWarmup authenticated={authenticated} />
      <NotificationListeners />
      <IdentitySessionRefresh authenticated={authenticated} />
      <MobileAccessGate authenticated={authenticated} />
      <PersonalEventStream authenticated={authenticated} />
      <RootLayoutNav
        authenticated={authenticated}
        pending={initialSessionPending}
        me={me}
        loading={loading}
        error={error}
        offlineEntryAvailable={offlineEntryAvailable}
        enterOffline={enterOffline}
      />
      {mode === "development" ? <DevelopmentIndicator /> : null}
    </View>
  );
}

/**
 * Hide routing only for the first authoritative profile hydration. Password
 * providers temporarily background the app and can trigger a later profile
 * revalidation; unmounting the auth stack then would discard the credentials
 * iOS is filling.
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
  const { me, refetch } = useMeContext();
  const enabled = authenticated && me?.hasEventAccess === true;
  useEffect(() => {
    if (!enabled) return;
    return startPersonalEventStream({
      enabled,
      identityKey: me?.id,
      onResync: () => {
        void refetch();
      },
    });
  }, [enabled, me?.id, refetch]);
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

/** Revalidates the one session/access/profile snapshot after role changes. */
function IdentitySessionRefresh({ authenticated }: { authenticated: boolean }) {
  const { me, refetch } = useMeContext();
  useEffect(() => {
    if (!authenticated) return;
    return subscribeToServerEvent(EVENTS.DOMAIN_CHANGED, () => {
      void refetch();
    });
  }, [authenticated, refetch]);
  useEffect(
    () =>
      startIdentityEventStream({
        enabled: authenticated,
        identityKey: me?.id,
        onResync: () => {
          void refetch();
        },
      }),
    [authenticated, me?.id, refetch],
  );
  return null;
}

/** Best-effort Expo push token registration once an eligible user signs in. */
function PushRegistration({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();
  useEffect(() => {
    if (authenticated && me?.hasEventAccess && me.id) {
      registerForPushNotifications(me.id).catch(() => {
        // Permission denial and simulators without push must not block the app.
      });
    }
  }, [authenticated, me?.hasEventAccess, me?.id]);
  return null;
}

/** Persist participant ticket details before a later connection outage (H28). */
function WalletCacheWarmup({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();

  useEffect(() => {
    if (!authenticated || !me?.hasEventAccess) return;
    void warmWalletCache(me.id);
  }, [authenticated, me?.id, me?.hasEventAccess]);

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
    if (
      !authenticated ||
      loading ||
      !me ||
      me.hasEventAccess ||
      me.accountState === "removal_pending"
    )
      return;
    void signOut().finally(() => {
      router.replace({
        pathname: "/(auth)/sign-in",
        params: { accessDenied: "1" },
      });
    });
  }, [authenticated, loading, me, router]);

  return null;
}

function RootLayoutNav({
  authenticated,
  pending,
  me,
  loading,
  error,
  offlineEntryAvailable,
  enterOffline,
}: {
  authenticated: boolean;
  pending: boolean;
  me: ReturnType<typeof useMeContext>["me"];
  loading: boolean;
  error: Error | null;
  offlineEntryAvailable: boolean;
  enterOffline: () => Promise<void>;
}) {
  const colorScheme = useColorScheme();
  const { refetch } = useMeContext();
  const showRestoringSession = useDelayedVisibility(!me && loading, 500);
  const canEnterApp = canEnterMobileApp(authenticated, me?.hasEventAccess);

  // Keep one navigator in charge of session transitions. Protected screens
  // are removed from navigation history when their guard changes, so signing
  // out cannot leave a stale tabs route underneath (or add a second sign-in
  // route while a nested redirect is already running).
  if (pending) return null;

  // Keep a profile restore recoverable when /api/me is temporarily unavailable
  // instead of rendering an auth stack before the session has been disproved.
  if (!me && (loading || error)) {
    // Most profile restores complete in a fraction of a second. Keep the
    // neutral app surface during that grace period instead of flashing a
    // transient status screen between the splash screen and the app.
    if (loading && !showRestoringSession) {
      return <View style={{ backgroundColor: colors.background, flex: 1 }} />;
    }
    return (
      <SessionState
        loading={loading}
        offlineAvailable={offlineEntryAvailable}
        onContinueOffline={() => void enterOffline()}
        onRetry={() => void refetch()}
      />
    );
  }

  if (me?.accountState === "removal_pending" && me.removal) {
    return (
      <PendingRemovalScreen
        removal={me.removal}
        onRefresh={async () => {
          await refetch();
        }}
        refreshError={error}
      />
    );
  }

  // Access is part of the navigation guard, not just an asynchronous sign-out
  // side effect. This prevents an ineligible account from mounting any event
  // screen during the frame(s) before MobileAccessGate revokes its session.
  if (isMobileAccessDenied(authenticated, me?.hasEventAccess)) {
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
              // Android uses the same in-screen chrome as the Schedule tab;
              // iOS keeps its native transparent large-title presentation.
              headerShown: process.env.EXPO_OS === "ios",
              headerTransparent: process.env.EXPO_OS === "ios",
              headerLargeTitle: process.env.EXPO_OS === "ios",
            }}
          />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

/** A persistent, non-interactive safety cue whenever requests target development. */
function DevelopmentIndicator() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="Development server active"
      style={{
        alignItems: "center",
        backgroundColor: "#d70015",
        borderCurve: "continuous",
        borderRadius: 999,
        paddingHorizontal: 9,
        paddingVertical: 4,
        position: "absolute",
        right: 12,
        // Keep this directly below the status indicators and above any
        // screen-specific header actions (search, filters, overflow, etc.).
        top: Math.max(0, insets.top - 4),
        zIndex: 10,
      }}
    >
      <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "800", letterSpacing: 0.5 }}>
        DEV
      </Text>
    </View>
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
