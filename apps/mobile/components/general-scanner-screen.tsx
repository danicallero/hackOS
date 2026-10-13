import { EVENTS } from "@hackos/shared/events";
import { useFocusEffect, usePathname, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
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

  return (
    <View style={{ backgroundColor: "black", flex: 1 }}>
      <Stack.Screen options={{ headerShown: glassAvailable, headerTitle: "" }} />
      <Text
        accessibilityRole="header"
        style={{
          position: "absolute",
          left: 24,
          top: insets.top + 8,
          color: "white",
          fontSize: 28,
          fontWeight: "700",
        }}
      >
        {t("tabScan")}
      </Text>
      <View
        pointerEvents="box-none"
        style={{
          left: 0,
          paddingTop: insets.top + 8,
          paddingLeft: 16,
          paddingRight: 16,
          alignItems: "flex-end",
          minHeight: insets.top + 56,
          zIndex: 30,
        }}
      >
        <View style={{ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ScannerRoleFilter
            options={roleOptions}
            groups={groups}
            onToggle={toggleGroup}
            onClear={clearGroups}
          />
          <ScannerQueueStatus
            queue={sync.queue}
            syncing={sync.syncing}
            onSync={() => void sync.sync()}
            onRetry={() => void sync.retryFailed()}
            onRetryOne={(id) => void sync.retryOne(id)}
            onDelete={(id) => void sync.discardScan(id)}
            clockSkewMs={sync.clockSkewMs}
            fillWidth={false}
          />
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <ScannerGroupStatistics
          stats={stats}
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
        />
        {error ? (
          <GlassView
            colorScheme="dark"
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
                  color: "white",
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
          nfcFirst
          hint={null}
          onClose={pathname === "/scan" ? undefined : () => safeBack(router, "/(tabs)/scan")}
          onValue={(value) => void resolve(value)}
        />
      </ScrollView>
    </View>
  );
}

/** H22–H26: labelled filter and People Finder controls stay directly reachable. */
function ScannerRoleFilter({
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
      colorScheme="dark"
      accessibilityLabel={t("scannerFilterGroups")}
      active={groups.length > 0}
      items={rows}
      onSelect={select}
    />
  );
}

function ScannerGroupStatistics({
  stats,
  onOpenPeople,
}: {
  stats: { accredited: number; confirmed: number; inside: number };
  onOpenPeople: () => void;
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
              color: "white",
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
            style={{ color: "rgba(255,255,255,0.72)", fontSize: 15 }}
          >
            {t("scannerAccredited")}
          </Text>
        </View>
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          isInteractive
          style={{ borderRadius: 24, flexShrink: 1 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("scannerViewPeople")}
            onPress={onOpenPeople}
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <SymbolView
              accessible={false}
              name="person.crop.badge.magnifyingglass"
              size={19}
              tintColor="white"
            />
            <Text style={{ color: "white", fontSize: 15, fontWeight: "500", flexShrink: 1 }}>
              {t("scannerViewPeople")}
            </Text>
          </Pressable>
        </GlassView>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 16,
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.16)",
          paddingBottom: 24,
        }}
      >
        {items.map((item) => (
          <View key={item.label} style={{ flex: 1, gap: 5 }}>
            <Text
              selectable
              maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
              style={{
                color: "white",
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
              style={{ color: "rgba(255,255,255,0.72)", fontSize: 13 }}
            >
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
