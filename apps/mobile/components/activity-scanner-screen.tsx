import { isMealActivityKind } from "@hackos/shared/activity-kinds";
import { EVENTS } from "@hackos/shared/events";
import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { AdaptiveBackButton } from "@/components/native-ui";
import { NfcReader } from "@/components/nfc-reader";
import { NATIVE_PANE_STACK, PaneNativeStack } from "@/components/pane-native-stack";
import { PeopleDirectoryScreen } from "@/components/people-directory-screen";
import { PeopleFinderPane } from "@/components/people-finder-pane";
import { PressableFeedback } from "@/components/pressable-feedback";
import { QrCamera } from "@/components/QrCamera";
import { QrCameraModal } from "@/components/qr-camera-modal";
import { RequestFeedback } from "@/components/RequestFeedback";
import { NfcScannerSurface } from "@/components/scanner-nfc-surface";
import { ScannerStatBlock } from "@/components/scanner-stat-block";
import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import { OfflineNotice } from "@/components/status-notice";
import { SymbolView } from "@/components/symbol";
import { UserAvatar } from "@/components/user-avatar";
import { resultCardMaxHeight } from "@/lib/activity-pane";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { bumpActivityScanned } from "@/lib/live-activities/sync";
import { subscribeToManualActivityScan } from "@/lib/manual-activity-scan";
import { useMeContext } from "@/lib/me-context";
import { safeBack } from "@/lib/navigation";
import { queueStatusBarItem, statusShowsLabel } from "@/lib/pane-header-items";
import { useRouterTabBarBottomInset } from "@/lib/router-tabs-inset";
import { scanOutcomeHaptic } from "@/lib/scan-haptics";
import {
  enqueueLocalScan,
  findPersonByBadge,
  findPersonById,
  findPersonByTicket,
  getActivityState,
  listScannerActivities,
  listScannerPeople,
} from "@/lib/scanner-db";
import { pendingActivityScans, pendingBadgeClaim } from "@/lib/scanner-model";
import { scannerQueueHealth } from "@/lib/scanner-state";
import { resolveActivityText, type ScannerActivity, type ScannerPerson } from "@/lib/scanner-types";
import { fixedScrollHeaderOptions, screenTitleElement } from "@/lib/screen-header-options";
import { startLogisticsEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { useNfcSupportStatus } from "@/lib/use-nfc-supported";
import { useScannerSync } from "@/lib/use-scanner";
import { radius, type } from "@/theme";
import { colors } from "@/theme/colors";
import {
  CHROME_MAX_FONT_SIZE_MULTIPLIER,
  CHROME_MIN_FONT_SCALE,
  isAccessibilityTextSize,
} from "@/theme/dynamic-type";
import {
  PANE_BAND_INSET,
  PANE_CONTROL_HEIGHT,
  PANE_CONTROL_TOP,
  PANE_TOOLBAR_RESERVE,
} from "@/theme/layout-activity-pane";
import { type StatBlockLayout, useOperatorLayout } from "@/theme/layout-screens";
import { SCREEN_TITLE } from "@/theme/screen-title";

interface ActivityScanResult {
  scanId?: string;
  badgeId: string;
  ticketToken?: string;
  count: number;
  person: ScannerPerson;
  state: "saved" | "confirmed" | "attention" | "repeat_pending";
  error?: string;
  wasRepeat?: boolean;
}

/**
 * One activity's scanner. As a route it owns the native header; `embedded` (the scanner pane of
 * the two-pane Activities window) takes the activity from `activityId`, draws its own title band
 * of height `topInset` and keeps the result overlay inside the pane, like the Schedule detail.
 */
/** Window width kept free for Back, the queue button and the bar's gutters beside the title. */
const TOOLBAR_TITLE_RESERVE = 180;

export function ActivityScannerScreen({
  activityId: embeddedActivityId,
  embedded = false,
  topInset = 0,
}: {
  activityId?: number;
  embedded?: boolean;
  topInset?: number;
} = {}) {
  const params = useLocalSearchParams<{
    id: string;
    manualBadge?: string;
    manualNonce?: string;
  }>();
  const activityId = embedded ? (embeddedActivityId ?? Number.NaN) : Number(params.id);
  // The People picker hands a badge back through route params; a pane has no such route.
  const manualBadge = embedded ? undefined : params.manualBadge;
  const manualNonce = embedded ? undefined : params.manualNonce;
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  // Embedded, the people finder covers this activity's pane only; the activity list is untouched.
  const [peopleOpen, setPeopleOpen] = useState(false);
  const router = useRouter();
  const { language, t } = useLocale();
  const insets = useSafeAreaInsets();
  const { gutter } = useOperatorLayout(null);
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const tabBarBottomInset = useRouterTabBarBottomInset();
  const glassAvailable = isRealLiquidGlassAvailable();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const syncState = useScannerSync();
  const { sync: runSync, refreshLocal, lastSync } = syncState;
  const [localActivity, setLocalActivity] = useState<ScannerActivity | null>(null);
  const [result, setResult] = useState<ActivityScanResult | null>(null);
  const focused = useIsFocused();
  const nfcSupport = useNfcSupportStatus();
  const nfcReadSucceeded = useRef(false);
  const androidStarted = useRef(false);
  const [nfcRunning, setNfcRunning] = useState(false);
  const [nfcVisible, setNfcVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [people, setPeople] = useState<ScannerPerson[] | null>(null);
  const [serverInside, setServerInside] = useState<number | null>(null);
  const stopNfc = useCallback(() => {
    setNfcRunning(false);
    setNfcVisible(false);
  }, []);
  useEffect(() => {
    if (!focused) {
      androidStarted.current = false;
      stopNfc();
      setCameraVisible(false);
    }
  }, [focused, stopNfc]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        stopNfc();
        setCameraVisible(false);
      }
    });
    return () => subscription.remove();
  }, [stopNfc]);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [insideError, setInsideError] = useState<Error | null>(null);
  const [statsError, setStatsError] = useState<Error | null>(null);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityError, setActivityError] = useState<Error | null>(null);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const handledManualScan = useRef<string | null>(null);
  const activity = useMemo(
    () =>
      syncState.serverSnapshot
        ? (syncState.serverSnapshot.activities.find((item) => item.id === activityId) ?? null)
        : localActivity,
    [activityId, localActivity, syncState.serverSnapshot],
  );
  const goBack = () =>
    cameraVisible ? setCameraVisible(false) : safeBack(router, "/(tabs)/activities");
  const activityName = activity ? resolveActivityText(activity, language) : t("scannerActivity");

  useEffect(() => {
    if (
      Platform.OS !== "android" ||
      !focused ||
      !activity ||
      nfcSupport !== "supported" ||
      androidStarted.current
    )
      return;
    androidStarted.current = true;
    nfcReadSucceeded.current = false;
    setNfcRunning(true);
    setNfcVisible(true);
  }, [focused, activity, nfcSupport]);

  const loadPeople = useCallback(() => {
    void listScannerPeople()
      .then(setPeople)
      .catch(() => {});
  }, []);
  useEffect(() => loadPeople(), [loadPeople]);
  useEffect(() => {
    if (lastSync) loadPeople();
  }, [lastSync, loadPeople]);
  const roster = syncState.serverSnapshot?.people ?? people;
  const inside =
    serverInside ?? roster?.filter((person) => person.lastPresenceKind === "in").length;
  const loadInside = useCallback(
    () =>
      apiFetch<{ byRole: { inside: number }[] }>("/api/scanner/role-stats")
        .then((response) => {
          setServerInside(response.byRole.reduce((sum, row) => sum + row.inside, 0));
          setInsideError(null);
          return true;
        })
        .catch((cause) => {
          setInsideError(cause instanceof Error ? cause : new Error(String(cause)));
          return false;
        }),
    [],
  );
  useEffect(() => {
    if (focused) loadInside();
  }, [focused, loadInside]);
  useEffect(() => {
    if (lastSync) loadInside();
  }, [lastSync, loadInside]);
  useEffect(
    () => startLogisticsEventStream({ identityKey: me?.id, onResync: loadInside }),
    [loadInside, me?.id],
  );
  useEffect(() => {
    const unsubscribes = [
      EVENTS.LOGISTICS_ACCREDITED,
      EVENTS.LOGISTICS_PRESENCE_SCAN,
      EVENTS.LOGISTICS_ACTIVITY_SCAN,
      EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
    ].map((event) => subscribeToServerEvent(event, loadInside, "logistics"));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [loadInside]);

  // H25/H26: only an explicitly started session reopens after reader teardown.
  useEffect(() => {
    if (!nfcRunning || !focused || result || registering || nfcVisible) return;
    const timeout = setTimeout(() => setNfcVisible(true), 500);
    return () => clearTimeout(timeout);
  }, [nfcRunning, focused, result, registering, nfcVisible]);

  const loadStats = useCallback(async () => {
    try {
      const response = await apiFetch<{ items: ActivityStats[] }>("/api/activities/scannable");
      setStats(response.items.find((item) => item.activityId === activityId) ?? null);
      setStatsError(null);
      return true;
    } catch (cause) {
      setStatsError(cause instanceof Error ? cause : new Error(String(cause)));
      return false;
    }
  }, [activityId]);

  useEffect(() => {
    void listScannerActivities()
      .then((items) => setLocalActivity(items.find((item) => item.id === activityId) ?? null))
      .catch((cause) => setActivityError(cause instanceof Error ? cause : new Error(String(cause))))
      .finally(() => setActivityLoaded(true));
  }, [activityId]);

  useEffect(() => {
    void loadStats();
    const interval = setInterval(() => void loadStats(), 10_000);
    return () => clearInterval(interval);
  }, [loadStats]);
  useEffect(() => {
    if (lastSync) void loadStats();
  }, [lastSync, loadStats]);

  const store = useCallback(
    async (
      person: ScannerPerson,
      badgeId: string,
      allowRepeat: boolean,
      count: number,
      ticketToken?: string,
      expectedUserId?: number,
    ) => {
      if (ownerUserId === undefined) return;
      setRegistering(true);
      setError(null);
      try {
        const scanId = await enqueueLocalScan(
          {
            kind: "activity",
            activityId,
            ...(ticketToken ? { ticketToken } : { badgeId }),
            ...(expectedUserId ? { expectedUserId } : {}),
            allowRepeat,
            scannedAt: new Date().toISOString(),
          },
          ownerUserId,
        );
        setResult({
          scanId,
          badgeId,
          ticketToken,
          count: count + 1,
          person,
          state: "saved",
          wasRepeat: allowRepeat,
        });
        void scanOutcomeHaptic("queued");
        // #966: the staff Live Activity counts distinct people (first scans).
        if (!allowRepeat) void bumpActivityScanned(activityId);
        await refreshLocal();
        void runSync()
          .then(() => loadStats())
          .catch(() => undefined);
      } finally {
        setRegistering(false);
      }
    },
    [activityId, loadStats, ownerUserId, refreshLocal, runSync],
  );

  useEffect(() => {
    if (!result?.scanId || result.state !== "saved") return;
    const scan = syncState.queue.find((item) => item.id === result.scanId);
    if (scan?.status === "failed") {
      void scanOutcomeHaptic("rejected");
      setResult((current) =>
        current?.scanId === scan.id
          ? {
              ...current,
              state: "attention",
              error: scan.lastError ?? t("presenceScanRejectedBody"),
            }
          : current,
      );
    } else if (scan?.status === "acknowledged") {
      void scanOutcomeHaptic("accepted");
      setResult((current) =>
        current?.scanId === scan.id ? { ...current, state: "confirmed" } : current,
      );
    }
  }, [result, syncState.queue, t]);

  const scanned = useCallback(
    async (raw: string) => {
      setRegistering(true);
      try {
        const badgeId = raw.trim();
        const serverPerson = syncState.serverSnapshot?.people.find(
          (candidate) => candidate.badgeId === badgeId || candidate.ticketToken === badgeId,
        );
        const ticketPerson = syncState.serverSnapshot ? null : await findPersonByTicket(badgeId);
        const found = syncState.serverSnapshot
          ? {
              person: serverPerson ?? null,
              revoked: syncState.serverSnapshot.people.some((person) =>
                person.revokedBadgeIds.includes(badgeId),
              ),
            }
          : ticketPerson
            ? { person: ticketPerson, revoked: false }
            : await findPersonByBadge(badgeId);
        // A badge given on this device whose accreditation has not synced yet is real for
        // the operator; the API reconciles it on replay and rejects the scan if it was not.
        let queuedOwner: ScannerPerson | null = null;
        if (!found.person) {
          const claim = pendingBadgeClaim(syncState.queue, badgeId);
          if (claim) {
            queuedOwner =
              "userId" in claim
                ? (syncState.serverSnapshot?.people.find((p) => p.userId === claim.userId) ??
                  (await findPersonById(claim.userId)))
                : (syncState.serverSnapshot?.people.find(
                    (p) => p.ticketToken === claim.ticketToken,
                  ) ?? (await findPersonByTicket(claim.ticketToken)));
          }
        }
        if (queuedOwner) found.person = queuedOwner;
        if (!found.person) {
          setError(found.revoked ? t("scannerBadgeRevoked") : t("scannerBadgeUnknown"));
          setResult(null);
          void scanOutcomeHaptic("unknown");
          return;
        }
        const ticketToken = found.person.ticketToken === badgeId ? badgeId : undefined;
        const localState = await getActivityState(found.person.userId, activityId);
        const state = syncState.serverSnapshot
          ? {
              userId: found.person.userId,
              activityId,
              count:
                syncState.serverSnapshot.activityStates.find(
                  (candidate) =>
                    candidate.userId === found.person!.userId &&
                    candidate.activityId === activityId,
                )?.count ?? 0,
            }
          : localState;
        setError(null);
        setRegistering(false);
        // H26: the server count misses scans still queued here, and the local roster misses
        // queued scans it could not tie to this person; either one makes this a repeat.
        const queued = pendingActivityScans(syncState.queue, activityId, found.person, badgeId);
        const count = Math.max(
          localState.count,
          syncState.serverSnapshot ? state.count + queued : queued,
        );
        if (count > 0) {
          void scanOutcomeHaptic("duplicate");
          setResult({
            badgeId,
            ticketToken,
            count,
            person: found.person,
            state: "repeat_pending",
            wasRepeat: true,
          });
          return;
        }
        await store(found.person, badgeId, false, count, ticketToken, queuedOwner?.userId);
      } finally {
        setRegistering(false);
      }
    },
    [activityId, store, syncState.queue, syncState.serverSnapshot, t],
  );

  useEffect(() => {
    if (!activity || !manualBadge || !manualNonce || handledManualScan.current === manualNonce)
      return;
    handledManualScan.current = manualNonce;
    void scanned(manualBadge);
  }, [activity, manualBadge, manualNonce, scanned]);

  useEffect(
    () => subscribeToManualActivityScan(activityId, (badgeId) => void scanned(badgeId)),
    [activityId, scanned],
  );

  // iOS two-pane: the pane is its own native stack. The title and the sync status are real bar
  // items of ITS header, "View people" pushes the Scanner's finder over it, and the route's header
  // is hidden by the host, so nothing transparent sits over the pane.
  const nativePane = embedded && NATIVE_PANE_STACK;
  const [statusOpen, setStatusOpen] = useState(false);
  const queueHealth = scannerQueueHealth(syncState.queue);
  const statusLabel =
    queueHealth.attention > 0 ? t("scannerStateAttention") : t("scannerStateReady");
  const rootOptions = useMemo(
    () => ({
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.background },
      headerTransparent: false,
      title: "",
      unstable_headerLeftItems: () => [
        {
          type: "custom" as const,
          element: screenTitleElement(activityName, {
            numberOfLines: 1,
            testID: UI_TEST_IDS.scanner.result,
          }),
          hidesSharedBackground: true,
        },
      ],
      unstable_headerRightItems: () => [
        {
          ...queueStatusBarItem({
            health: queueHealth,
            label: statusLabel,
            onPress: () => setStatusOpen(true),
            showLabel: statusShowsLabel(paneWidth ?? 0, isAccessibilityTextSize(fontScale)),
          }),
          // Busy while a sync runs.
          selected: syncState.syncing,
        },
      ],
    }),
    [activityName, fontScale, paneWidth, queueHealth, statusLabel, syncState.syncing],
  );
  const queueStatus = (
    <ScannerQueueStatus
      queue={syncState.queue}
      syncing={syncState.syncing}
      onSync={() => void syncState.sync()}
      onRetry={() => void syncState.retryFailed()}
      onRetryOne={(id) => void syncState.retryOne(id)}
      onDelete={(id) => void syncState.discardScan(id)}
      clockSkewMs={syncState.clockSkewMs}
      fillWidth={false}
      nativeToolbar={glassAvailable && !embedded}
      triggerless={nativePane}
      open={nativePane ? statusOpen : undefined}
      onOpenChange={nativePane ? setStatusOpen : undefined}
    />
  );

  const screenView = (
    <View
      onLayout={
        embedded
          ? ({ nativeEvent }) => {
              setPaneWidth((current) =>
                current === nativeEvent.layout.width ? current : nativeEvent.layout.width,
              );
              setPaneHeight((current) =>
                current === nativeEvent.layout.height ? current : nativeEvent.layout.height,
              );
            }
          : undefined
      }
      style={{
        backgroundColor: colors.background,
        flex: 1,
        overflow: embedded ? "hidden" : undefined,
      }}
    >
      {embedded ? null : (
        <Stack.Screen
          options={
            glassAvailable
              ? { ...fixedScrollHeaderOptions(activityName), headerBackVisible: false }
              : { headerShown: false }
          }
        />
      )}
      <QrCameraModal visible={cameraVisible} onClose={() => setCameraVisible(false)}>
        <QrCamera
          hideNfc
          autoStartNfc={false}
          requestCameraOnFocus
          onClose={() => setCameraVisible(false)}
          onValue={(value) => {
            setCameraVisible(false);
            void scanned(value);
          }}
          scanningEnabled={Boolean(activity) && !result && !registering}
        />
      </QrCameraModal>
      <NfcReader
        visible={nfcRunning && nfcVisible && focused && !result && !registering}
        showAndroidOverlay={false}
        onValue={(value) => {
          nfcReadSucceeded.current = true;
          setNfcVisible(false);
          void scanned(value);
        }}
        onClose={() => {
          setNfcVisible(false);
          if (!nfcReadSucceeded.current) stopNfc();
          nfcReadSucceeded.current = false;
        }}
      />
      {glassAvailable || embedded ? null : (
        <AdaptiveBackButton
          top={insets.top}
          colorScheme="auto"
          tintColor={colors.label}
          onPress={goBack}
        />
      )}
      {nativePane ? (
        queueStatus
      ) : embedded ? (
        <View
          pointerEvents="box-none"
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 12,
            height: PANE_CONTROL_HEIGHT,
            left: 0,
            paddingLeft: PANE_BAND_INSET,
            paddingRight: PANE_TOOLBAR_RESERVE,
            position: "absolute",
            right: 0,
            top: PANE_CONTROL_TOP,
            zIndex: 30,
          }}
        >
          {peopleOpen ? (
            // The finder covers the pane's title line, so the activity name steps aside.
            <View style={{ flex: 1 }} />
          ) : (
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
              adjustsFontSizeToFit
              minimumFontScale={CHROME_MIN_FONT_SCALE}
              testID={UI_TEST_IDS.scanner.result}
              style={{ color: colors.label, flex: 1, ...SCREEN_TITLE }}
            >
              {activityName}
            </Text>
          )}
          {queueStatus}
        </View>
      ) : glassAvailable ? (
        queueStatus
      ) : (
        <View
          pointerEvents="box-none"
          style={{ position: "absolute", top: insets.top, right: gutter, zIndex: 30 }}
        >
          {queueStatus}
        </View>
      )}
      {glassAvailable && !embedded ? (
        // Same title treatment as the Scan tab. Back shares this group: a second
        // left toolbar would replace it.
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            accessibilityLabel={t("back")}
            icon="chevron.left"
            onPress={goBack}
          />
          <Stack.Toolbar.View hidesSharedBackground>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
              adjustsFontSizeToFit
              minimumFontScale={CHROME_MIN_FONT_SCALE}
              testID={UI_TEST_IDS.scanner.result}
              // A long name must truncate: an over-wide title makes UIKit move Back and the
              // queue button into the bar's overflow menu.
              style={{
                color: colors.label,
                maxWidth: Math.max(96, windowWidth - TOOLBAR_TITLE_RESERVE),
                ...SCREEN_TITLE,
              }}
            >
              {activityName}
            </Text>
          </Stack.Toolbar.View>
        </Stack.Toolbar>
      ) : null}
      {glassAvailable || embedded ? null : (
        <View
          testID={UI_TEST_IDS.scanner.result}
          // H55: the bold leading title every Android bar uses, beside the back circle.
          style={{
            height: 44,
            justifyContent: "center",
            left: 72,
            position: "absolute",
            right: 140,
            top: insets.top,
          }}
        >
          <Text
            accessibilityRole="header"
            selectable
            numberOfLines={1}
            maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
            adjustsFontSizeToFit
            minimumFontScale={CHROME_MIN_FONT_SCALE}
            style={{ ...type.title2, color: colors.label }}
          >
            {activityName}
          </Text>
        </View>
      )}
      <View style={{ flex: 1, marginTop: nativePane ? 0 : embedded ? topInset : insets.top + 56 }}>
        <NfcScannerSurface
          header={(layout) => (
            <>
              {!activity && !activityLoaded ? <RequestFeedback loading compact /> : null}
              {!activity && activityLoaded ? (
                <RequestFeedback
                  error={activityError ?? new Error(t("requestUnavailable"))}
                  message={t("requestUnavailable")}
                  onRetry={() => void runSync()}
                  retrying={syncState.syncing}
                />
              ) : null}
              {/* Offline is not a failure: scans are queued, only the live figures are missing. */}
              {insideError || statsError ? (
                <OfflineNotice
                  onReconnect={async () =>
                    (await Promise.all([loadInside(), loadStats()])).every(Boolean)
                  }
                />
              ) : null}
              <ActivityStatistics
                activity={activity}
                stats={stats}
                inside={inside}
                offline={Boolean(insideError || statsError)}
                layout={layout.stats}
              />
              {error ? (
                <GlassView
                  colorScheme="auto"
                  glassEffectStyle="regular"
                  style={{
                    borderRadius: radius.container,
                    marginTop: 12,
                    minHeight: 60,
                    overflow: "hidden",
                  }}
                >
                  <Pressable
                    accessibilityLabel={error}
                    accessibilityHint={t("close")}
                    accessibilityRole="button"
                    accessibilityLiveRegion="assertive"
                    onPress={() => setError(null)}
                    style={{
                      minHeight: 60,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      gap: 9,
                      padding: 14,
                    }}
                  >
                    <SymbolView
                      accessible={false}
                      name="xmark.circle.fill"
                      tintColor={colors.destructive}
                      size={20}
                    />
                    <Text
                      selectable
                      style={{
                        ...type.compact,
                        color: colors.label,
                        flexShrink: 1,

                        fontWeight: "600",
                        textAlign: "center",
                      }}
                    >
                      {error}
                    </Text>
                  </Pressable>
                </GlassView>
              ) : null}
            </>
          )}
          onOpenPeople={() =>
            embedded
              ? setPeopleOpen(true)
              : router.push({
                  pathname: "/(tabs)/activities/people",
                  params: { activityId: String(activityId) },
                })
          }
          onValue={(value) => void scanned(value)}
          nfcActive={nfcRunning && focused && !result && !registering}
          nfcStartLabel={t("scannerNfcStart")}
          scanningEnabled={Boolean(activity) && !result && !registering}
          onNfc={
            nfcSupport === "supported"
              ? () => {
                  if (nfcRunning) stopNfc();
                  else {
                    nfcReadSucceeded.current = false;
                    setNfcRunning(true);
                    setNfcVisible(true);
                  }
                }
              : undefined
          }
          onCamera={() => {
            stopNfc();
            setCameraVisible(true);
          }}
          onManual={stopNfc}
        />
      </View>
      {embedded && !nativePane ? (
        <PeopleFinderPane
          backLabel={t("tabActivities")}
          onClose={() => setPeopleOpen(false)}
          onSelect={(person) => {
            // The same path as the People picker route: the chosen badge is scanned as if read.
            setPeopleOpen(false);
            if (person.badgeId) void scanned(person.badgeId);
          }}
          open={peopleOpen}
          requireBadge
        />
      ) : null}
      {result ? (
        <ActivityResultPanel
          activity={activity}
          language={language}
          result={result}
          registering={registering}
          tabBarBottomInset={tabBarBottomInset}
          pane={embedded ? { height: paneHeight, band: nativePane ? 0 : topInset } : null}
          onCancel={() => {
            setResult(null);
            setRegistering(false);
          }}
          onContinue={() => {
            setResult(null);
          }}
          onRegisterAnother={() =>
            void store(result.person, result.badgeId, true, result.count, result.ticketToken)
          }
        />
      ) : null}
    </View>
  );
  if (!nativePane) return screenView;
  return (
    <PaneNativeStack
      enabled
      pushed={{
        open: peopleOpen,
        onClose: () => setPeopleOpen(false),
        // Icon-only back circle, like the standalone People.
        options: { headerBackButtonDisplayMode: "minimal" },
        render: () => (
          <PeopleDirectoryScreen
            embedded
            nativeHeader
            onSelect={(person) => {
              // The same path as the People picker route: the chosen badge is scanned as if read.
              setPeopleOpen(false);
              if (person.badgeId) void scanned(person.badgeId);
            }}
            requireBadge
          />
        ),
      }}
      rootOptions={rootOptions}
    >
      {screenView}
    </PaneNativeStack>
  );
}

function ActivityResultPanel({
  activity,
  language,
  registering,
  result,
  tabBarBottomInset,
  pane,
  onCancel,
  onContinue,
  onRegisterAnother,
}: {
  activity: ScannerActivity | null;
  language: "en" | "es" | "gl";
  registering: boolean;
  result: ActivityScanResult;
  tabBarBottomInset: number;
  /** Set when the result sits inside a pane below its title band instead of over the window. */
  pane: { height: number | null; band: number } | null;
  onCancel: () => void;
  onContinue: () => void;
  onRegisterAnother: () => void;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth, fontScale } = useWindowDimensions();
  const meal = isMealActivityKind(activity?.category);
  const repeatPending = result.state === "repeat_pending";
  const fullName =
    [result.person.name, result.person.surname].filter(Boolean).join(" ") || result.person.email;
  // One tone per outcome, shared by the avatar badge and the status strip.
  const tone = repeatPending
    ? {
        symbol: "clock.badge.exclamationmark" as const,
        color: colors.warning,
        surface: colors.warningSurface,
        onSurface: colors.onWarningSurface,
      }
    : result.state === "confirmed"
      ? {
          symbol: "checkmark.circle.fill" as const,
          color: colors.success,
          surface: colors.successSurface,
          onSurface: colors.onSuccessSurface,
        }
      : result.state === "attention"
        ? {
            symbol: "exclamationmark.triangle.fill" as const,
            color: colors.destructive,
            surface: colors.destructiveSurface,
            onSurface: colors.onDestructiveSurface,
          }
        : {
            symbol: "internaldrive.fill" as const,
            color: colors.warning,
            surface: colors.warningSurface,
            onSurface: colors.onWarningSurface,
          };
  const statusLabel = repeatPending
    ? t("scannerRepeatFound")
    : result.state === "confirmed"
      ? t("scannerStateConfirmed")
      : result.state === "attention"
        ? t("scannerStateAttention")
        : t("scannerStateSaved");
  const countLabel = meal ? t("scannerServed") : t("scannerPasses");
  const hasMealDetails =
    meal &&
    (result.person.intolerances.length > 0 ||
      result.person.foodIntoleranceNotes ||
      result.person.notes);
  // Keep the scan feedback centered in the screen. Long dietary
  // details scroll without moving the decision buttons off screen.
  const cardMaxHeight = resultCardMaxHeight({
    windowHeight,
    insetsTop: insets.top,
    insetsBottom: insets.bottom,
    tabBarBottomInset,
    pane,
  });

  return (
    <View
      accessibilityViewIsModal
      style={{
        alignItems: "center",
        bottom: 0,
        justifyContent: "center",
        left: 0,
        paddingBottom: 20,
        paddingHorizontal: 20,
        paddingTop: 20,
        position: "absolute",
        right: 0,
        top: pane?.band ?? 0,
      }}
    >
      <View
        style={{
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: radius.sheet,
          maxHeight: cardMaxHeight,
          maxWidth: 390,
          overflow: "hidden",
          width: "100%",
        }}
      >
        <View style={{ flexShrink: 1, maxHeight: cardMaxHeight, overflow: "hidden" }}>
          <ScrollView
            style={{ flexGrow: 0, flexShrink: 1, minHeight: 0 }}
            contentContainerStyle={{ gap: 16, padding: 20 }}
          >
            {/* Staff match the photo to the person in front of them (#934). */}
            <View style={{ alignItems: "center", gap: 4 }}>
              <Text
                accessibilityLiveRegion="polite"
                selectable
                style={{
                  ...type.footnote,
                  color: tone.color,
                  fontWeight: "600",
                  marginBottom: 12,
                  textAlign: "center",
                }}
              >
                {statusLabel}
              </Text>
              <View style={{ marginBottom: 8 }}>
                <UserAvatar
                  testID="scan-result-avatar"
                  userId={result.person.userId}
                  name={result.person.name ?? ""}
                  surname={result.person.surname}
                  image={result.person.photoUrl}
                  size={80}
                />
                <View
                  style={{
                    alignItems: "center",
                    backgroundColor: colors.surface,
                    borderRadius: radius.full,
                    bottom: -2,
                    height: 30,
                    justifyContent: "center",
                    position: "absolute",
                    right: -2,
                    width: 30,
                  }}
                >
                  <SymbolView
                    accessible={false}
                    name={tone.symbol}
                    tintColor={tone.color}
                    size={24}
                  />
                </View>
              </View>
              <Text
                selectable
                numberOfLines={2}
                style={{
                  ...type.title2,
                  color: colors.label,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                {fullName}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                style={{ ...type.compact, color: colors.secondaryLabel, textAlign: "center" }}
              >
                {result.person.email || t("accountNotSet")}
              </Text>
            </View>

            <View
              accessible
              accessibilityLabel={`${result.count} ${countLabel}`}
              style={{
                alignItems: "center",
                borderTopColor: colors.separator,
                borderTopWidth: StyleSheet.hairlineWidth,
                paddingTop: 14,
              }}
            >
              <Text
                style={{
                  ...type.largeTitle,
                  color: tone.color,
                  fontVariant: ["tabular-nums"],
                  fontWeight: "700",
                }}
              >
                {result.count}
              </Text>
              <Text style={{ ...type.footnote, color: colors.secondaryLabel }}>{countLabel}</Text>
            </View>

            {hasMealDetails ? (
              <View
                style={{
                  backgroundColor: colors.warningSurface,
                  borderCurve: "continuous",
                  borderRadius: radius.control,
                  gap: 12,
                  padding: 14,
                }}
              >
                <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
                  <SymbolView
                    accessible={false}
                    name="exclamationmark.triangle.fill"
                    tintColor={colors.warning}
                    size={18}
                  />
                  <Text
                    selectable
                    accessibilityRole="header"
                    style={{ ...type.callout, color: colors.onWarningSurface, fontWeight: "600" }}
                  >
                    {t("scannerDietaryGroup")}
                  </Text>
                </View>
                {result.person.intolerances.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {result.person.intolerances.map((item) => (
                      <View
                        key={item.id}
                        style={{
                          backgroundColor: colors.surface,
                          borderCurve: "continuous",
                          borderRadius: radius.full,
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                        }}
                      >
                        <Text
                          selectable
                          style={{ ...type.subhead, color: colors.label, fontWeight: "600" }}
                        >
                          {item.label[language] ?? item.label.en}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {result.person.foodIntoleranceNotes ? (
                  <View style={{ gap: 2 }}>
                    <Text
                      selectable
                      style={{
                        ...type.footnote,
                        color: colors.onWarningSurface,
                        fontWeight: "600",
                      }}
                    >
                      {t("personFoodNotes")}
                    </Text>
                    <Text selectable style={{ ...type.subhead, color: colors.label }}>
                      {result.person.foodIntoleranceNotes}
                    </Text>
                  </View>
                ) : null}
                {result.person.notes ? (
                  <View style={{ gap: 2 }}>
                    <Text
                      selectable
                      style={{
                        ...type.footnote,
                        color: colors.onWarningSurface,
                        fontWeight: "600",
                      }}
                    >
                      {t("personNotes")}
                    </Text>
                    <Text selectable style={{ ...type.subhead, color: colors.label }}>
                      {result.person.notes}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            {result.error ? (
              <Text
                accessibilityLiveRegion="assertive"
                selectable
                style={{ ...type.compact, color: colors.destructive, fontWeight: "700" }}
              >
                {t("scannerBusinessRejected")}: {result.error}
              </Text>
            ) : null}
          </ScrollView>

          <View
            style={{
              flexShrink: 0,
              minHeight: 50,
              borderTopColor: colors.separator,
              borderTopWidth: 1,
              padding: 20,
            }}
          >
            <View
              style={{
                flexDirection: windowWidth < 360 || fontScale > 1.3 ? "column" : "row",
                gap: 8,
              }}
            >
              {repeatPending ? (
                <>
                  <ResultActionButton
                    disabled={registering}
                    label={t("scannerRepeatNoAdd")}
                    onPress={onCancel}
                    secondary
                  />
                  <ResultActionButton
                    disabled={registering}
                    label={t("scannerRepeatAdd")}
                    onPress={onRegisterAnother}
                  />
                </>
              ) : (
                <ResultActionButton
                  testID={UI_TEST_IDS.scanner.continue}
                  label={t("close")}
                  onPress={onContinue}
                />
              )}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function ResultActionButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  testID?: string;
}) {
  return (
    <PressableFeedback
      feedback="scale"
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        flexGrow: 1,
        backgroundColor: secondary ? colors.elevatedSurface : colors.primaryAction,
        borderRadius: radius.full,
        minHeight: 50,
        paddingVertical: 12,
        justifyContent: "center",
        paddingHorizontal: 12,
      }}
    >
      <Text
        selectable
        style={{
          ...type.callout,
          color: secondary ? colors.interactiveText : colors.primaryActionText,

          fontWeight: "600",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </PressableFeedback>
  );
}

interface ActivityStats {
  activityId: number;
  count: number;
  distinctPeople: number;
  repeats: number;
}

function ActivityStatistics({
  activity,
  stats,
  inside,
  offline,
  layout,
}: {
  activity: ScannerActivity | null;
  stats: ActivityStats | null;
  inside: number | undefined;
  offline: boolean;
  layout: StatBlockLayout;
}) {
  const { t } = useLocale();
  const meal = isMealActivityKind(activity?.category);
  const pending = offline ? "–" : "…";
  return (
    <ScannerStatBlock
      capped={false}
      layout={layout}
      primary={{
        label: meal ? t("scannerServingsTotal") : t("scannerScansTotal"),
        value: stats?.count ?? pending,
      }}
      secondary={[
        { label: t("scannerDistinctPeople"), value: stats?.distinctPeople ?? pending },
        {
          label: meal ? t("scannerExtraServings") : t("scannerExtraScans"),
          value: stats?.repeats ?? pending,
        },
        { label: t("scannerInsideBuilding"), value: inside ?? pending, divider: true },
      ]}
    />
  );
}
