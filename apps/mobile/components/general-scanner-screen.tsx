import { EVENTS } from "@hackos/shared/events";
import { useFocusEffect, usePathname, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FilterMenu } from "@/components/filter-menu";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { QrCamera } from "@/components/QrCamera";
import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { safeBack } from "@/lib/navigation";
import {
  ROLE_FILTER_ALL_ICON,
  type RoleFilterOption,
  roleDisplayName,
  roleFilterOptionsFromRoster,
} from "@/lib/role-filters";
import { findPersonByBadge, findPersonByTicket, listScannerPeople } from "@/lib/scanner-db";
import {
  isAccreditationEligible,
  loadScannerRoleFilter,
  matchesScannerRole,
  saveScannerRoleFilter,
} from "@/lib/scanner-group-filter";
import type { ScannerPerson } from "@/lib/scanner-types";
import { startLogisticsEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { useSideRegion } from "@/lib/side-region";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";

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
  const sideRegion = useSideRegion();
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
      router.push({
        pathname: "/scan/person/[id]",
        params: { id: String(person.userId) },
      });
    },
    [router, sync.serverSnapshot, t],
  );

  const roleFilter = (
    <ScannerRoleFilter
      options={roleOptions}
      groups={groups}
      onToggle={toggleGroup}
      onClear={clearGroups}
    />
  );
  const filterInColumn = glassAvailable && Boolean(sideRegion.edge);
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
      nativeToolbar={glassAvailable}
      toolbarAccessory={glassAvailable && !filterInColumn ? roleFilter : undefined}
    />
  );
  const title = (
    <Text
      accessibilityRole="header"
      style={{ color: colors.label, fontSize: 28, fontWeight: "700" }}
    >
      {t("tabScan")}
    </Text>
  );

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <Stack.Screen options={{ headerShown: glassAvailable, headerTitle: "" }} />
      {glassAvailable ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.View hidesSharedBackground>{title}</Stack.Toolbar.View>
          </Stack.Toolbar>
          {queueStatus}
          {filterInColumn ? (
            <Stack.Toolbar placement="right">
              <ScannerRoleFilter
                asToolbarItem
                options={roleOptions}
                groups={groups}
                onToggle={toggleGroup}
                onClear={clearGroups}
              />
            </Stack.Toolbar>
          ) : null}
        </>
      ) : (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: insets.top,
            left: 24,
            right: 16,
            height: 48,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "space-between",
            zIndex: 30,
          }}
        >
          {title}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {roleFilter}
            {queueStatus}
          </View>
        </View>
      )}
      <View style={{ flex: 1, marginTop: insets.top + 56 }}>
        <ScannerGroupStatistics stats={stats} />
        {error ? (
          <GlassView
            colorScheme="auto"
            glassEffectStyle="regular"
            style={{
              borderRadius: 14,
              marginTop: 12,
              marginHorizontal: 32,
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
                  color: colors.label,
                  flexShrink: 1,
                  fontSize: 14,
                  fontWeight: "600",
                  textAlign: "center",
                }}
              >
                {error}
              </Text>
            </Pressable>
          </GlassView>
        ) : null}
        <QrCamera
          onOpenPeople={() =>
            router.push(
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
    </View>
  );
}

/** H22–H26: labelled filter and People Finder controls stay directly reachable. */
function ScannerRoleFilter({
  options,
  groups,
  onToggle,
  onClear,
  asToolbarItem = false,
}: {
  options: RoleFilterOption[];
  groups: string[];
  onToggle: (group: string) => void;
  onClear: () => void;
  asToolbarItem?: boolean;
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

  if (asToolbarItem) {
    // A native menu item, so the system can move it into a vertical bar beside a
    // side column; the custom filter view stays horizontal.
    return (
      <Stack.Toolbar.Menu
        icon="line.3.horizontal.decrease"
        accessibilityLabel={t("scannerFilterGroups")}
        tintColor={groups.length > 0 ? colors.accent : undefined}
      >
        {rows.map((row) => (
          <Stack.Toolbar.MenuAction
            key={row.id}
            isOn={row.selected}
            unstable_keepPresented
            onPress={() => select(row.id)}
          >
            {row.label}
          </Stack.Toolbar.MenuAction>
        ))}
      </Stack.Toolbar.Menu>
    );
  }
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
}: {
  stats: { accredited: number; confirmed: number; inside: number };
}) {
  const { t } = useLocale();
  const items = [
    { label: t("scannerStatConfirmed"), value: stats.confirmed },
    { label: t("scannerInside"), value: stats.inside },
  ];
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, gap: 24 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <View style={{ gap: 4, flexShrink: 1 }}>
          <Text
            selectable
            maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
            style={{
              color: colors.label,
              fontSize: 44,
              fontWeight: "700",
              fontVariant: ["tabular-nums"],
            }}
          >
            {stats.accredited}
          </Text>
          <Text
            selectable
            maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
            style={{ color: colors.secondaryLabel, fontSize: 15 }}
          >
            {t("scannerAccredited")}
          </Text>
        </View>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.separator,
          paddingBottom: 24,
        }}
      >
        {items.map((item) => (
          <View key={item.label} style={{ flex: 1, gap: 5 }}>
            <Text
              selectable
              maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
              style={{
                color: colors.label,
                fontSize: 28,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              }}
            >
              {item.value}
            </Text>
            <Text
              selectable
              maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
              style={{ color: colors.secondaryLabel, fontSize: 13, lineHeight: 18 }}
            >
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
