import { EVENTS } from "@hackos/shared/events";
import { usePathname, useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "@/components/glass-view";
import { QrCamera } from "@/components/QrCamera";
import { ScannerQueueStatus } from "@/components/scanner-transaction-status";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { findPersonByBadge, findPersonByTicket, listScannerPeople } from "@/lib/scanner-db";
import {
  isAccreditationEligible,
  loadScannerGroupFilter,
  matchesScannerGroup,
  type ScannerGroup,
  saveScannerGroupFilter,
} from "@/lib/scanner-group-filter";
import type { ScannerPerson } from "@/lib/scanner-types";
import { startLogisticsEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

interface ScannerRoleStat {
  role: ScannerPerson["role"];
  eligible: number;
  accredited: number;
  inside: number;
}

export function GeneralScannerScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const usesTopTabBar = process.env.EXPO_OS === "ios" && width >= 700;
  const pathname = usePathname();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const sync = useScannerSync();
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [groups, setGroups] = useState<ScannerGroup[]>([]);
  const [roleStats, setRoleStats] = useState<ScannerRoleStat[] | null>(null);

  useEffect(() => {
    void loadScannerGroupFilter().then(setGroups);
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
        // Offline or request failed — the local-roster fallback in `stats`
        // below keeps the tiles usable, just without cross-device accuracy.
      });
  }, []);

  useEffect(() => loadRoleStats(), [loadRoleStats]);
  useEffect(() => {
    if (sync.lastSync) loadRoleStats();
  }, [loadRoleStats, sync.lastSync]);
  // Any device's accreditation/presence/activity scan pushes here, so the
  // tiles update within a second of another operator's scan instead of
  // waiting on this device's own next sync tick.
  useEffect(() => startLogisticsEventStream(), []);
  useEffect(
    () => subscribeToServerEvent(EVENTS.LOGISTICS_ACCREDITED, loadRoleStats),
    [loadRoleStats],
  );
  useEffect(
    () => subscribeToServerEvent(EVENTS.LOGISTICS_PRESENCE_SCAN, loadRoleStats),
    [loadRoleStats],
  );
  useEffect(
    () => subscribeToServerEvent(EVENTS.LOGISTICS_ACTIVITY_SCAN, loadRoleStats),
    [loadRoleStats],
  );
  useEffect(
    () => subscribeToServerEvent(EVENTS.LOGISTICS_MEAL_SCAN_BATCH, loadRoleStats),
    [loadRoleStats],
  );

  const toggleGroup = useCallback((group: ScannerGroup) => {
    setGroups((current) => {
      const next = current.includes(group)
        ? current.filter((value) => value !== group)
        : [...current, group];
      void saveScannerGroupFilter(next);
      return next;
    });
  }, []);

  const clearGroups = useCallback(() => {
    setGroups([]);
    void saveScannerGroupFilter([]);
  }, []);

  const stats = useMemo(() => {
    if (roleStats) {
      const filtered = roleStats.filter((row) => matchesScannerGroup(row.role, groups));
      return {
        accredited: filtered.reduce((sum, row) => sum + row.accredited, 0),
        confirmed: filtered.reduce((sum, row) => sum + row.eligible, 0),
        inside: filtered.reduce((sum, row) => sum + row.inside, 0),
      };
    }
    const filtered = people.filter((person) => matchesScannerGroup(person.role, groups));
    return {
      accredited: filtered.filter((person) => person.badgeId !== null).length,
      confirmed: filtered.filter((person) => isAccreditationEligible(person)).length,
      inside: filtered.filter((person) => person.lastPresenceKind === "in").length,
    };
  }, [roleStats, people, groups]);

  const resolve = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      const byTicket = await findPersonByTicket(value);
      const badge = byTicket ? null : await findPersonByBadge(value);
      const person = byTicket ?? badge?.person ?? null;
      if (!person) {
        setError(badge?.revoked ? t("scannerBadgeRevoked") : t("scannerUnknownQr"));
        return;
      }
      setError(null);
      void haptic("light");
      router.push({
        pathname: "/(tabs)/scan/person/[id]",
        params: { id: String(person.userId) },
      });
    },
    [router, t],
  );

  return (
    <View style={{ backgroundColor: "black", flex: 1 }}>
      <Stack.Screen options={{ headerTitle: "" }} />
      <QrCamera
        hint={null}
        onClose={pathname === "/scan" ? undefined : () => router.back()}
        onValue={(value) => void resolve(value)}
      />
      <ScannerToolbarActions
        top={insets.top + 4}
        groups={groups}
        onToggle={toggleGroup}
        onClear={clearGroups}
        onOpenPeople={() => router.push("/(tabs)/scan/people")}
        peopleLabel={t("scannerViewPeople")}
      />
      <View
        pointerEvents="box-none"
        style={
          usesTopTabBar
            ? // The native tab bar's real on-screen width doesn't line up
              // with any fixed breakpoint we can compute here (it's driven
              // by the OS's own layout, not `width`), so a pill sharing
              // that row risks landing underneath it at some window size —
              // this row is always clear, regardless of resolution.
              { left: 0, position: "absolute", right: 0, top: insets.top + 150 }
            : { left: 0, position: "absolute", right: 0, top: insets.top + 4 }
        }
      >
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
      <View
        pointerEvents="none"
        style={{
          left: 0,
          position: "absolute",
          right: 0,
          top: insets.top + 56,
        }}
      >
        <ScannerGroupStatistics stats={stats} />
      </View>
      {error ? (
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          style={{
            borderRadius: 14,
            bottom: insets.bottom + 26,
            left: 16,
            minHeight: 60,
            overflow: "hidden",
            position: "absolute",
            right: 94,
          }}
        >
          <Pressable
            accessibilityLabel={error}
            accessibilityHint={t("close")}
            accessibilityRole="button"
            onPress={() => setError(null)}
            accessibilityLiveRegion="assertive"
            style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 9, padding: 14 }}
          >
            <SymbolView
              accessible={false}
              name="xmark.circle.fill"
              tintColor={colors.destructive}
              size={20}
            />
            <Text selectable style={{ color: "white", flex: 1, fontSize: 16, fontWeight: "700" }}>
              {error}
            </Text>
          </Pressable>
        </GlassView>
      ) : null}
    </View>
  );
}

/** Keeps the filter's outside-tap backdrop and panel above every other floating control (stats tiles, sync pill, camera controls). */
const FILTER_PANEL_Z_INDEX = 1000;

const GROUP_FILTERS: Array<{
  value: ScannerGroup;
  labelKey: "roleParticipants" | "roleMentor" | "roleStaff" | "roleSponsor";
  icon: "person" | "person.2" | "person.crop.circle.badge.checkmark" | "briefcase";
}> = [
  { value: "participant", labelKey: "roleParticipants", icon: "person" },
  { value: "mentor", labelKey: "roleMentor", icon: "person.2" },
  { value: "staff", labelKey: "roleStaff", icon: "person.crop.circle.badge.checkmark" },
  { value: "sponsor", labelKey: "roleSponsor", icon: "briefcase" },
];

/**
 * The group-filter and people-finder controls, side by side in one
 * elongated glass pill — see `ScannerGroupFilterButton`.
 *
 * `Stack.Toolbar.Menu`'s `unstable_keepPresented` (the native "stays open
 * across taps" option) turned out to live up to its name — in practice the
 * menu still closed after every action and its toolbar placement sat at a
 * different height than the rest of this screen's floating chrome (the
 * "Ready" sync pill included). So the filter panel stays a custom panel
 * instead of `MenuView`/`Stack.Toolbar.Menu` (neither of which support
 * staying open across taps). It previously lived in its own separate
 * circular button next to people-finder's; the two are now one pill (same
 * combined footprint, single glass shape) so both stay a direct one-tap
 * action instead of one being buried inside the other's menu.
 */
function ScannerToolbarActions({
  top,
  groups,
  onToggle,
  onClear,
  onOpenPeople,
  peopleLabel,
}: {
  top: number;
  groups: ScannerGroup[];
  onToggle: (group: ScannerGroup) => void;
  onClear: () => void;
  onOpenPeople: () => void;
  peopleLabel: string;
}) {
  return (
    <ScannerGroupFilterButton
      top={top}
      groups={groups}
      onToggle={onToggle}
      onClear={onClear}
      onOpenPeople={onOpenPeople}
      peopleLabel={peopleLabel}
    />
  );
}

/**
 * Floating group-filter + people-finder pill: one elongated glass shape
 * with two side-by-side tap zones instead of two separate circular
 * buttons — same combined footprint, but reads as one control. Left zone
 * opens the filter panel below the pill (stays open
 * across multiple role toggles, closing only on an outside tap, so the
 * operator can build up a combination like participants + sponsors in one
 * go); right zone navigates straight to the people finder, one tap.
 */
function ScannerGroupFilterButton({
  top,
  groups,
  onToggle,
  onClear,
  onOpenPeople,
  peopleLabel,
}: {
  top: number;
  groups: ScannerGroup[];
  onToggle: (group: ScannerGroup) => void;
  onClear: () => void;
  onOpenPeople: () => void;
  peopleLabel: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const filterIcon =
    groups.length === 0 ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill";
  const rows = [
    { value: null, labelKey: "roleAll" as const, icon: "person.2" as const },
    ...GROUP_FILTERS,
  ];

  return (
    <>
      {open ? (
        <Pressable
          accessibilityLabel={t("close")}
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={{
            bottom: 0,
            left: 0,
            position: "absolute",
            right: 0,
            top: 0,
            zIndex: FILTER_PANEL_Z_INDEX,
          }}
        />
      ) : null}
      <GlassView
        colorScheme="dark"
        glassEffectStyle="regular"
        isInteractive
        style={{
          borderRadius: 22,
          flexDirection: "row",
          height: 44,
          position: "absolute",
          right: 16,
          top,
          width: 88,
          zIndex: FILTER_PANEL_Z_INDEX + 1,
        }}
      >
        <Pressable
          accessibilityLabel={t("scannerFilterGroups")}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            void haptic("light");
            setOpen((current) => !current);
          }}
          // Hit area still spans the full half (unchanged flex:1) — only
          // the icon's visual position nudges toward the pill's middle,
          // now that there's no divider marking each half's own center.
          style={{ alignItems: "center", flex: 1, justifyContent: "center", paddingLeft: 8 }}
        >
          <SymbolView name={filterIcon} tintColor="white" size={19} weight="semibold" />
        </Pressable>
        <Pressable
          accessibilityLabel={peopleLabel}
          accessibilityRole="button"
          onPress={() => {
            void haptic("light");
            onOpenPeople();
          }}
          style={{ alignItems: "center", flex: 1, justifyContent: "center", paddingRight: 8 }}
        >
          <SymbolView
            name="person.crop.badge.magnifyingglass"
            tintColor="white"
            size={19}
            weight="semibold"
          />
        </Pressable>
      </GlassView>
      {open ? (
        <View
          style={{
            position: "absolute",
            right: 16,
            top: top + 52,
            width: 220,
            zIndex: FILTER_PANEL_Z_INDEX + 1,
          }}
        >
          <GlassView
            colorScheme="dark"
            glassEffectStyle="regular"
            style={{
              borderColor: "rgba(255,255,255,0.14)",
              borderCurve: "continuous",
              borderRadius: 18,
              borderWidth: 0.5,
              elevation: 12,
              overflow: "hidden",
              shadowColor: "#000",
              shadowOffset: { height: 6, width: 0 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
            }}
          >
            {rows.map((row, index) => {
              const selected =
                row.value === null ? groups.length === 0 : groups.includes(row.value);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={row.value ?? "all"}
                  onPress={() => {
                    void haptic("selection");
                    if (row.value === null) onClear();
                    else onToggle(row.value);
                  }}
                  style={{
                    alignItems: "center",
                    borderTopColor: "rgba(255,255,255,0.12)",
                    borderTopWidth: index === 0 ? 0 : 0.5,
                    flexDirection: "row",
                    gap: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <SymbolView accessible={false} name={row.icon} tintColor="white" size={16} />
                  <Text
                    selectable={false}
                    style={{ color: "white", flex: 1, fontSize: 15, fontWeight: "600" }}
                  >
                    {t(row.labelKey)}
                  </Text>
                  {selected ? (
                    <SymbolView
                      accessible={false}
                      name="checkmark"
                      tintColor={colors.accent}
                      size={15}
                      weight="bold"
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </GlassView>
        </View>
      ) : null}
    </>
  );
}

function ScannerGroupStatistics({
  stats,
}: {
  stats: { accredited: number; confirmed: number; inside: number };
}) {
  const { t } = useLocale();
  const items = [
    { icon: "person.2", label: t("scannerStatConfirmed"), value: stats.confirmed },
    { icon: "lanyardcard", label: t("scannerAccredited"), value: stats.accredited },
    { icon: "building.2", label: t("scannerInside"), value: stats.inside },
  ] as const;

  return (
    <View
      pointerEvents="none"
      style={{ flexDirection: "row", gap: 8, marginTop: 10, paddingHorizontal: 16 }}
    >
      {items.map((item) => (
        <GlassView
          colorScheme="dark"
          glassEffectStyle="regular"
          key={item.label}
          style={{
            borderCurve: "continuous",
            borderRadius: 16,
            flex: 1,
            gap: 5,
            padding: 12,
          }}
        >
          <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
            <SymbolView accessible={false} name={item.icon} tintColor="white" size={14} />
            <Text
              selectable
              numberOfLines={1}
              style={{ color: "rgba(255,255,255,0.72)", flex: 1, fontSize: 11, fontWeight: "600" }}
            >
              {item.label}
            </Text>
          </View>
          <Text
            selectable
            style={{
              color: "white",
              fontSize: 24,
              fontVariant: ["tabular-nums"],
              fontWeight: "700",
            }}
          >
            {item.value}
          </Text>
        </GlassView>
      ))}
    </View>
  );
}
