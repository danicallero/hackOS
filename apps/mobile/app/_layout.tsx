import { EVENTS } from "@hackos/shared/events";
import { useFonts } from "expo-font";
import { type Href, usePathname, useRootNavigationState, useRouter } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { Stack } from "expo-router/stack";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import "react-native-reanimated";

import { AdaptiveFrame } from "@/components/adaptive-frame";
import { AlertHost } from "@/components/alert-host";
import { AppBackGesture } from "@/components/app-back-gesture";
import { MaintenanceScreen } from "@/components/maintenance-screen";
import { PendingRemovalScreen } from "@/components/pending-removal-screen";
import { SessionState } from "@/components/session-state";
import { UpgradeRequiredScreen } from "@/components/upgrade-required-screen";
import { useColorScheme } from "@/components/useColorScheme";
import { ApiModeProvider, useApiMode } from "@/lib/api-mode";
import { signOut } from "@/lib/auth-client";
import { collectCompanyTagHref, takePendingCompanyTag } from "@/lib/company-tag-link";
import { isSupportedLanguage, LocaleProvider, useLocale } from "@/lib/i18n";
import { useLiveActivities } from "@/lib/live-activities/use-live-activities";
import { useMaintenancePhase } from "@/lib/maintenance";
import { MeProvider, useMeContext } from "@/lib/me-context";
import { canEnterMobileApp, isMobileAccessDenied } from "@/lib/mobile-access";
import { nativeStackScreenOptions, transparentDetailHeaderOptions } from "@/lib/navigation";
import { setNfcShield } from "@/lib/nfc-reader";
import {
  NOTIFICATION_ONBOARDING_PATH,
  shouldPresentNotificationOnboarding,
} from "@/lib/notification-onboarding";
import { setupNotificationListeners } from "@/lib/notifications-setup";
import {
  PROFILE_TASKS_PATH,
  promptableProfileTasks,
  shouldPresentProfileTasks,
} from "@/lib/profile-tasks";
import { registerForPushNotifications } from "@/lib/push";
import { useOrientationPolicy } from "@/lib/screen-orientation";
import { startPersonalEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { sideRegionForInsets } from "@/lib/side-region";
import { isOperator } from "@/lib/tabs";
import { useUpgradeRequired } from "@/lib/upgrade-required";
import { useLocalReminders } from "@/lib/use-local-reminders";
import { useSideInsets } from "@/lib/vertical-bar-edge";
import { warmWalletCache } from "@/lib/wallet-cache";
import { colors, navigationCanvas, radius, type } from "@/theme";

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

  // H22–H26: Android only; keeps system tag dispatch off while the app is open.
  useEffect(() => {
    setNfcShield(true);
    return () => setNfcShield(false);
  }, []);

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
          <AlertHost />
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
  const upgradeRequired = useUpgradeRequired();
  const maintenancePhase = useMaintenancePhase();
  useOrientationPolicy();

  // The API refuses every request from this build (#999); nothing else can work.
  if (upgradeRequired) return <UpgradeRequiredScreen />;
  // A database restore is in progress (#539); the screen resumes the app itself.
  if (maintenancePhase) return <MaintenanceScreen phase={maintenancePhase} />;

  return (
    <View style={{ flex: 1 }}>
      <LanguageSync />
      <PushRegistration authenticated={authenticated} />
      <LocalReminders authenticated={authenticated} />
      <LiveActivities authenticated={authenticated} />
      <WalletCacheWarmup authenticated={authenticated} />
      <NotificationListeners />
      <MobileAccessGate authenticated={authenticated} />
      <PersonalEventStream authenticated={authenticated} />
      <ProfileTasksPrompt authenticated={authenticated} sessionPending={initialSessionPending} />
      <NotificationOnboardingPrompt
        authenticated={authenticated}
        sessionPending={initialSessionPending}
      />
      <PendingCompanyTagResume authenticated={authenticated} />
      <AdaptiveFrame padSides={false}>
        <AppBackGesture>
          <RootLayoutNav
            authenticated={authenticated}
            pending={initialSessionPending}
            me={me}
            loading={loading}
            error={error}
            offlineEntryAvailable={offlineEntryAvailable}
            enterOffline={enterOffline}
          />
        </AppBackGesture>
      </AdaptiveFrame>
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

/** Push-independent queue, wallet and session updates over one personal stream. */
function PersonalEventStream({ authenticated }: { authenticated: boolean }) {
  const { me, refetch } = useMeContext();
  const enabled = authenticated;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refetch();
    }, 150);
  }, [refetch]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!enabled) return;
    const unsubscribes = [
      EVENTS.USER_SESSION_CHANGED,
      EVENTS.USER_QUEUE_CHANGED,
      EVENTS.LOGISTICS_WALLET_PASS_UPDATED,
    ].map((event) =>
      subscribeToServerEvent(event, () => {
        scheduleRefresh();
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [enabled, scheduleRefresh]);
  useEffect(() => {
    if (!enabled) return;
    return startPersonalEventStream({
      enabled,
      identityKey: me?.id,
      onResync: (context) => {
        // useMe owns the account facts foreground read; the stream recovers its other scoped models (#892).
        if (context.reason !== "foreground") scheduleRefresh();
      },
    });
  }, [enabled, me?.id, scheduleRefresh]);
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

/** Device-local activity reminders for an eligible signed-in user (H51, H59). */
function LocalReminders({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();
  useLocalReminders({ userId: me?.id ?? null, enabled: authenticated && !!me?.hasEventAccess });
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

/** #966: Live Activities (iOS) / Live Updates (Android) for H38 and H25/H26. */
function LiveActivities({ authenticated }: { authenticated: boolean }) {
  const { me } = useMeContext();
  const { language } = useLocale();
  useLiveActivities({
    signedIn: authenticated && Boolean(me?.hasEventAccess),
    userId: me?.id ?? null,
    language,
  });
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

/**
 * #933: opens the pending-profile-tasks sheet once per session after a fresh
 * /api/me, deferring while a scanner is open so it never interrupts a scan.
 * The sheet itself records the presentation when it mounts.
 */
function ProfileTasksPrompt({
  authenticated,
  sessionPending,
}: {
  authenticated: boolean;
  sessionPending: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, offline } = useMeContext();
  const navigationState = useRootNavigationState();
  const present =
    authenticated &&
    shouldPresentProfileTasks({
      me,
      offline,
      navigationReady: Boolean(navigationState?.key),
      sessionPending,
      pathname,
    });
  const tasks = me ? promptableProfileTasks(me).join(",") : "";
  // Only guards the frames between push and the route change, not the session.
  const requestedFrom = useRef<string | null>(null);

  useEffect(() => {
    if (!present || requestedFrom.current === pathname) return;
    requestedFrom.current = pathname;
    router.push({ pathname: PROFILE_TASKS_PATH, params: { tasks } });
  }, [pathname, present, router, tasks]);

  useEffect(() => {
    if (requestedFrom.current !== pathname) requestedFrom.current = null;
  }, [pathname]);

  return null;
}

/**
 * H51: opens the first-run notification channel sheet once per session, after
 * the profile sheet and never over a scanner.
 */
function NotificationOnboardingPrompt({
  authenticated,
  sessionPending,
}: {
  authenticated: boolean;
  sessionPending: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, offline } = useMeContext();
  const navigationState = useRootNavigationState();
  const base = {
    me,
    offline,
    navigationReady: Boolean(navigationState?.key),
    sessionPending,
    pathname,
  };
  const present =
    authenticated &&
    shouldPresentNotificationOnboarding({
      ...base,
      profileTasksPending: shouldPresentProfileTasks(base),
    });
  const requestedFrom = useRef<string | null>(null);

  useEffect(() => {
    if (!present || requestedFrom.current === pathname) return;
    requestedFrom.current = pathname;
    router.push(NOTIFICATION_ONBOARDING_PATH);
  }, [pathname, present, router]);

  useEffect(() => {
    if (requestedFrom.current !== pathname) requestedFrom.current = null;
  }, [pathname]);

  return null;
}

/**
 * #935: a company-tag link opened while signed out (`app/s/[code].tsx`) is
 * collected once the account may enter the app.
 */
function PendingCompanyTagResume({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();
  const { me } = useMeContext();
  const navigationState = useRootNavigationState();
  const canEnter = canEnterMobileApp(authenticated, me?.hasEventAccess);
  const ready = Boolean(navigationState?.key);

  useEffect(() => {
    if (!canEnter || !ready || !me) return;
    const code = takePendingCompanyTag();
    if (code) router.replace(collectCompanyTagHref(code, me.capabilities));
  }, [canEnter, ready, me, router]);

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
  const safeInsets = useSideInsets();
  const { refetch } = useMeContext();
  const showRestoringSession = useDelayedVisibility(!me && loading, 500);
  const canEnterApp = canEnterMobileApp(authenticated, me?.hasEventAccess);
  // One page colour for every screen: the navigation theme canvas is a fixed black, so a screen
  // that paints nothing itself would show it (pitch black on Mac and iPad) beside the grouped page.
  const page = { backgroundColor: colors.background };
  const sidePadding = { ...page, paddingLeft: safeInsets.left, paddingRight: safeInsets.right };
  const noSidePadding = { ...page, paddingLeft: 0, paddingRight: 0 };

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
    <ThemeProvider
      value={{
        ...(colorScheme === "dark" ? DarkTheme : DefaultTheme),
        colors: {
          ...(colorScheme === "dark" ? DarkTheme.colors : DefaultTheme.colors),
          background: navigationCanvas[colorScheme === "dark" ? "dark" : "light"],
        },
      }}
    >
      <Stack
        screenOptions={{
          ...nativeStackScreenOptions,
          // Foreground content stays clear of the side the system reserves on a foldable
          // iPhone (asymmetric insets). The tab layout and native sheets handle their own.
          contentStyle: sidePadding,
        }}
      >
        <Stack.Protected guard={!authenticated}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={canEnterApp}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen
            name="(tabs)"
            // The tab layout pads its own content so its bar can use the side column.
            options={{ contentStyle: noSidePadding, headerShown: false }}
          />
          <Stack.Screen
            name="projects"
            // Its own Stack pads its content, leaving the native bars the side column.
            options={{ contentStyle: noSidePadding, headerShown: false }}
          />
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
          <Stack.Screen
            name="people/[id]"
            options={{
              // #935 directory profile: Android draws its own back button;
              // iOS uses the transparent native header of the other detail
              // screens, so no band ever covers the centred avatar.
              ...transparentDetailHeaderOptions,
              headerShown: process.env.EXPO_OS === "ios",
            }}
          />
          <Stack.Screen
            name="profile-tasks"
            options={{ contentStyle: noSidePadding, headerShown: false, presentation: "modal" }}
          />
          <Stack.Screen
            name="notification-onboarding"
            options={{ contentStyle: noSidePadding, headerShown: false, presentation: "modal" }}
          />
          <Stack.Screen
            name="networking-profile"
            options={{ contentStyle: noSidePadding, headerShown: false, presentation: "modal" }}
          />
        </Stack.Protected>
        {/* #935 company-tag links resolve for any session state. */}
        <Stack.Screen name="s/[code]" options={{ headerShown: false }} />
      </Stack>
    </ThemeProvider>
  );
}

/** A persistent, non-interactive safety cue whenever requests target development. */
function DevelopmentIndicator() {
  const insets = useSafeAreaInsets();
  // Outside the frame that provides the side region, so derived from the insets.
  const sideInsets = useSideInsets();
  const sideRegion = sideRegionForInsets(sideInsets);
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="Development server active"
      style={{
        alignItems: "center",
        backgroundColor: "#d70015",
        borderCurve: "continuous",
        borderRadius: radius.full,
        paddingHorizontal: 9,
        paddingVertical: 4,
        position: "absolute",
        // Beside a side column it sits in the bottom corner away from it, clear of the
        // column's bars; elsewhere top-right below the status indicators.
        ...(sideRegion.edge
          ? { bottom: Math.max(insets.bottom, 8) + 4, left: 12 }
          : {
              right: sideInsets.right + 12,
              top: Math.max(0, insets.top - 4),
            }),
        zIndex: 10,
      }}
    >
      <Text
        style={{
          color: "#ffffff",
          fontSize: type.caption.fontSize,
          fontWeight: "800",
          letterSpacing: 0.5,
        }}
      >
        {/* Safe-area sides, to read what a foldable pose reports (Split View, outer display). */}
        {`DEV ${Math.round(sideInsets.left)}|${Math.round(sideInsets.right)}`}
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
