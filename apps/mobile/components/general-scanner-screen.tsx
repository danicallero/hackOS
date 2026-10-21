import { EVENTS } from "@hackos/shared/events";
import { useFocusEffect, useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FilterMenu } from "@/components/filter-menu";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { NATIVE_PANE_STACK, PanePeopleStack } from "@/components/pane-people-stack";
import { PanePlaceholder } from "@/components/pane-placeholder";
import { PersonOperationsScreen } from "@/components/person-operations-screen";
import { QrCamera } from "@/components/QrCamera";
import { ScannerStatBlock } from "@/components/scanner-stat-block";
import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import { SymbolView } from "@/components/symbol";
import { SystemBlur } from "@/components/system-blur";
import { apiFetch } from "@/lib/api";
import { useBookCrease } from "@/lib/fold-region";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { safeBack } from "@/lib/navigation";
import { resolveListPaneWidth } from "@/lib/pane-width";
import {
  ROLE_FILTER_ALL_ICON,
  type RoleFilterOption,
  roleDisplayName,
  roleFilterOptionsFromRoster,
} from "@/lib/role-filters";
import {
  backAction,
  detailBandOpacity,
  nextSelection,
  peopleDestination,
  type ScanSelection,
  scanDestination,
  selectionFromParams,
  selectionKey,
} from "@/lib/scan-pane";
import { findPersonByBadge, findPersonByTicket, listScannerPeople } from "@/lib/scanner-db";
import {
  isAccreditationEligible,
  loadScannerRoleFilter,
  matchesScannerRole,
  saveScannerRoleFilter,
} from "@/lib/scanner-group-filter";
import type { ScannerPerson } from "@/lib/scanner-types";
import { startLogisticsEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { useScannerSync } from "@/lib/use-scanner";
import { listDetailLayout } from "@/lib/window-size";
import { radius, type } from "@/theme";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";
import { SCAN_DETAIL_MAX_WIDTH } from "@/theme/layout-scan-pane";
import { type StatBlockLayout, useOperatorLayout } from "@/theme/layout-screens";
import { SCREEN_TITLE, twoPaneBandHeight } from "@/theme/screen-title";

interface ScannerRoleStat {
  role: ScannerPerson["role"];
  hasCapabilities: boolean;
  eligible: number;
  accredited: number;
  inside: number;
}

export function GeneralScannerScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const glassAvailable = isRealLiquidGlassAvailable();
  const { gutter } = useOperatorLayout(null);
  const [barHeight, setBarHeight] = useState(48);
  // A window with room for a list beside a detail keeps the reader on the left and opens the
  // scanned person on the right, like Schedule; narrower windows push the person route. The
  // reader sits at the same place in the tree either way, so a fold or rotation never remounts it.
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const crease = useBookCrease();
  const paneLayout = listDetailLayout(windowWidth, windowHeight, Platform.OS, crease);
  const twoPane = paneLayout.enabled;
  const listWidth = resolveListPaneWidth(windowWidth, paneLayout, crease);
  const detailBand = twoPaneBandHeight(fontScale);
  // Lives above the layout branch (and mirrors the route params) so it survives resize and rotation.
  const [selection, setSelection] = useState<ScanSelection | null>(null);
  const [detailOffset, setDetailOffset] = useState(0);
  const selectedKey = selection ? selectionKey(selection) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new profile starts at the top.
  useEffect(() => setDetailOffset(0), [selectedKey]);
  const params = useLocalSearchParams<{
    personId?: string;
    focusLogId?: string;
    focusSource?: string;
  }>();
  // Deep link `scan/person/<id>` (and the people list or history) in two panes lands here as params.
  useEffect(() => {
    const requested = selectionFromParams(params);
    if (!requested) return;
    setSelection((current) => nextSelection(current, requested));
    router.setParams({ personId: undefined, focusLogId: undefined, focusSource: undefined });
  }, [params, router]);
  // The people finder covers the reader only (never the right pane); like the selection it lives
  // above the layout branch, so a fold or rotation neither remounts the camera nor closes it.
  const [peopleOpen, setPeopleOpen] = useState(false);
  const back = backAction(twoPane, peopleOpen, selection);
  // The finder covers the whole pane, the title line included, so the pane's title steps aside.
  const finderCovering = twoPane && peopleOpen;
  // iOS two-pane: the scanner pane is its own native stack (title, role filter and sync status in
  // ITS bar, the finder pushed over it), so the route's header and toolbars step aside.
  const nativePane = NATIVE_PANE_STACK && twoPane;
  useFocusEffect(
    useCallback(() => {
      if (back === "system") return undefined;
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        if (back === "close-people") setPeopleOpen(false);
        else setSelection(null);
        return true;
      });
      return () => subscription.remove();
    }, [back]),
  );
  const selectFromFinder = useCallback((person: ScannerPerson) => {
    const picked = { userId: person.userId };
    setSelection((current) => nextSelection(current, picked));
    setPeopleOpen(false);
  }, []);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timeout);
  }, [error]);

  const sync = useScannerSync();
  const { me } = useMeContext();
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [roleStats, setRoleStats] = useState<ScannerRoleStat[] | null>(null);
  // SQLite is only the offline roster. Once the server has answered, use its
  // people for both the counters and QR resolution.
  const directory = sync.serverSnapshot?.people ?? people;
  const roleOptions = useMemo(
    () => roleFilterOptionsFromRoster(directory, (role) => roleDisplayName(role, t)),
    [directory, t],
  );

  useEffect(() => {
    void loadScannerRoleFilter().then(setGroups);
  }, []);

  const loadPeople = useCallback(() => {
    void listScannerPeople().then(setPeople);
  }, []);

  useEffect(() => loadPeople(), [loadPeople]);
  useEffect(() => {
    if (sync.lastSync) loadPeople();
  }, [loadPeople, sync.lastSync]);

  // Server-side per-role counts are refreshed by scoped logistics events,
  // rather than a global cache version. Falls back to the local roster below
  // when offline.
  const loadRoleStats = useCallback(() => {
    void apiFetch<{ byRole: ScannerRoleStat[] }>("/api/scanner/role-stats")
      .then((res) => setRoleStats(res.byRole))
      .catch(() => {
        setRoleStats(null);
        // Offline or request failed — the local-roster fallback in `stats`
        // below keeps the tiles usable, just without cross-device accuracy.
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRoleStats();
      return undefined;
    }, [loadRoleStats]),
  );
  useEffect(() => {
    if (sync.lastSync) loadRoleStats();
  }, [loadRoleStats, sync.lastSync]);
  // Any device's accreditation/presence/activity scan pushes here, so the
  // tiles update within a second of another operator's scan instead of
  // waiting on this device's own next sync tick.
  useEffect(
    () =>
      startLogisticsEventStream({
        identityKey: me?.id,
        onResync: loadRoleStats,
      }),
    [loadRoleStats, me?.id],
  );
  useEffect(() => {
    const events = [
      EVENTS.LOGISTICS_ACCREDITED,
      EVENTS.LOGISTICS_PRESENCE_SCAN,
      EVENTS.LOGISTICS_ACTIVITY_SCAN,
      EVENTS.LOGISTICS_MEAL_SCAN_BATCH,
    ];
    const unsubscribes = [
      ...events.map((event) => subscribeToServerEvent(event, loadRoleStats, "logistics")),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [loadRoleStats]);

  const toggleGroup = useCallback((group: string) => {
    setGroups((current) => {
      const next = current.includes(group)
        ? current.filter((value) => value !== group)
        : [...current, group];
      void saveScannerRoleFilter(next);
      return next;
    });
  }, []);

  const clearGroups = useCallback(() => {
    setGroups([]);
    void saveScannerRoleFilter([]);
  }, []);

  const stats = useMemo(() => {
    if (roleStats) {
      const filtered = roleStats.filter((row) => matchesScannerRole(row, groups));
      return {
        accredited: filtered.reduce((sum, row) => sum + row.accredited, 0),
        confirmed: filtered.reduce((sum, row) => sum + row.eligible, 0),
        inside: filtered.reduce((sum, row) => sum + row.inside, 0),
      };
    }
    const filtered = directory.filter((person) => matchesScannerRole(person, groups));
    return {
      accredited: filtered.filter((person) => person.badgeId !== null).length,
      confirmed: filtered.filter((person) => isAccreditationEligible(person)).length,
      inside: filtered.filter((person) => person.lastPresenceKind === "in").length,
    };
  }, [roleStats, directory, groups]);

  const resolve = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      const serverPerson = sync.serverSnapshot?.people.find(
        (candidate) => candidate.ticketToken === value || candidate.badgeId === value,
      );
      const byTicket = sync.serverSnapshot ? null : await findPersonByTicket(value);
      const badge = sync.serverSnapshot ? null : byTicket ? null : await findPersonByBadge(value);
      const person = sync.serverSnapshot
        ? (serverPerson ?? null)
        : (byTicket ?? badge?.person ?? null);
      if (!person) {
        setError(badge?.revoked ? t("scannerBadgeRevoked") : t("scannerUnknownQr"));
        return;
      }
      setError(null);
      void haptic("light");
      if (scanDestination(twoPane) === "pane") {
        const scanned = { userId: person.userId };
        setSelection((current) => nextSelection(current, scanned));
        return;
      }
      router.push({
        pathname: "/scan/person/[id]",
        params: { id: String(person.userId) },
      });
    },
    [router, sync.serverSnapshot, t, twoPane],
  );

  const roleFilter = useScannerRoleFilterMenu({
    options: roleOptions,
    groups,
    onToggle: toggleGroup,
    onClear: clearGroups,
  });
  const queueStatus = (
    <ScannerQueueStatus
      queue={sync.queue}
      syncing={sync.syncing}
      onSync={() => void sync.sync()}
      onRetry={() => void sync.retryFailed()}
      onRetryOne={(id) => void sync.retryOne(id)}
      onDelete={(id) => void sync.discardScan(id)}
      clockSkewMs={sync.clockSkewMs}
      fillWidth={false}
      nativeToolbar={glassAvailable && !nativePane}
      toolbarAccessory={glassAvailable && !nativePane ? roleFilter : undefined}
    />
  );
  const title = (
    <Text
      accessibilityRole="header"
      // Beside the fixed-size native toolbar items the title is capped; in the in-page row it
      // wraps and pushes the content down.
      maxFontSizeMultiplier={glassAvailable ? CHROME_MAX_FONT_SIZE_MULTIPLIER : undefined}
      style={{ color: colors.label, flexShrink: 1, ...SCREEN_TITLE }}
    >
      {t("tabScan")}
    </Text>
  );

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <Stack.Screen options={{ headerShown: glassAvailable && !nativePane, headerTitle: "" }} />
      {nativePane ? null : glassAvailable ? (
        <>
          <Stack.Toolbar placement="left">
            {finderCovering ? null : (
              <Stack.Toolbar.View hidesSharedBackground>{title}</Stack.Toolbar.View>
            )}
          </Stack.Toolbar>
          {queueStatus}
        </>
      ) : (
        <View
          pointerEvents="box-none"
          onLayout={(e) => setBarHeight(Math.max(48, e.nativeEvent.layout.height))}
          style={{
            position: "absolute",
            top: insets.top,
            left: gutter,
            ...(twoPane ? { width: listWidth - 2 * gutter } : { right: gutter }),
            minHeight: 48,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "space-between",
            zIndex: 30,
          }}
        >
          {finderCovering ? <View /> : title}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {roleFilter}
            {queueStatus}
          </View>
        </View>
      )}
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View
          style={{
            flex: twoPane ? 0 : 1,
            // The finder slides in from this pane's right edge and must not spill over the detail.
            overflow: "hidden",
            width: twoPane ? listWidth : undefined,
          }}
        >
          <PanePeopleStack
            backLabel={t("tabScan")}
            enabled={twoPane}
            onClose={() => setPeopleOpen(false)}
            onSelect={selectFromFinder}
            open={peopleOpen}
            rootHeaderRight={
              <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
                {roleFilter}
                {queueStatus}
              </View>
            }
            rootTitle={t("tabScan")}
          >
            <View style={{ flex: 1, marginTop: nativePane ? 0 : insets.top + barHeight + 8 }}>
              <QrCamera
                surfaceHeader={(layout) => (
                  <>
                    <ScannerGroupStatistics stats={stats} layout={layout.stats} />
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
                          onPress={() => setError(null)}
                          accessibilityLiveRegion="assertive"
                          style={{
                            minHeight: 60,
                            justifyContent: "center",
                            alignItems: "center",
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
                  peopleDestination(twoPane) === "overlay"
                    ? setPeopleOpen(true)
                    : router.push(
                        // Android's legacy (non-Liquid-Glass) header lands on a plain
                        // title with a separate search icon to tap; this jumps straight
                        // into search with the keyboard up instead. iOS uses the native
                        // `headerSearchBarOptions` bar there, unaffected by this param.
                        process.env.EXPO_OS === "android"
                          ? { pathname: "/(tabs)/scan/people", params: { autoSearch: "1" } }
                          : "/(tabs)/scan/people",
                      )
                }
                nfcFirst
                hint={null}
                onClose={pathname === "/scan" ? undefined : () => safeBack(router, "/(tabs)/scan")}
                onValue={(value) => void resolve(value)}
              />
            </View>
          </PanePeopleStack>
        </View>
        {twoPane ? (
          <View
            style={{
              borderLeftColor: colors.separator,
              borderLeftWidth: StyleSheet.hairlineWidth,
              flex: 1,
              paddingLeft: paneLayout.gutter,
            }}
          >
            <View
              style={{
                alignSelf: "center",
                flex: 1,
                maxWidth: SCAN_DETAIL_MAX_WIDTH,
                width: "100%",
              }}
            >
              {selection ? (
                <>
                  <PersonOperationsScreen
                    key={selectionKey(selection)}
                    embedded
                    focusLogId={selection.focusLogId}
                    focusSource={selection.focusSource}
                    onScrollOffset={setDetailOffset}
                    topInset={detailBand}
                    userId={selection.userId}
                  />
                  {/* The detail's top band: a backing that fades in as the profile scrolls under it. */}
                  <View
                    pointerEvents="none"
                    style={{
                      height: detailBand,
                      left: 0,
                      opacity: detailBandOpacity(detailOffset),
                      position: "absolute",
                      right: 0,
                      top: 0,
                    }}
                  >
                    <SystemBlur />
                  </View>
                </>
              ) : (
                <PanePlaceholder
                  body={t("panePlaceholderScanBody")}
                  icon="qrcode.viewfinder"
                  title={t("panePlaceholderScanTitle")}
                />
              )}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** H22–H26: labelled filter and People Finder controls stay directly reachable. */
function useScannerRoleFilterMenu({
  options,
  groups,
  onToggle,
  onClear,
}: {
  options: RoleFilterOption[];
  groups: string[];
  onToggle: (group: string) => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const rows = [
    { id: "all", label: t("roleAll"), icon: ROLE_FILTER_ALL_ICON, selected: groups.length === 0 },
    ...options.map((option) => ({
      id: `role:${option.value}`,
      label: option.label,
      icon: option.icon,
      selected: groups.includes(option.value),
    })),
  ];
  const select = (id: string) => {
    void haptic("selection");
    if (id === "all") onClear();
    else onToggle(id.slice("role:".length));
  };

  return (
    <FilterMenu
      colorScheme="auto"
      accessibilityLabel={t("scannerFilterGroups")}
      active={groups.length > 0}
      items={rows}
      onSelect={select}
    />
  );
}

function ScannerGroupStatistics({
  stats,
  layout,
}: {
  stats: { accredited: number; confirmed: number; inside: number };
  layout: StatBlockLayout;
}) {
  const { t } = useLocale();
  return (
    <ScannerStatBlock
      layout={layout}
      primary={{ label: t("scannerAccredited"), value: stats.accredited }}
      secondary={[
        { label: t("scannerStatConfirmed"), value: stats.confirmed },
        { label: t("scannerInside"), value: stats.inside },
      ]}
    />
  );
}
