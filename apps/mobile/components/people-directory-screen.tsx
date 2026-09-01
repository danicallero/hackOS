import { MenuView } from "@expo/ui/community/menu";
import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  usePathname,
  useRouter,
  useScrollToTop,
} from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import {
  AndroidFilterMenu,
  EmptyState,
  LegacyHeaderIconButton,
  LegacyScreenHeader,
  Separator,
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { emitManualActivityScan } from "@/lib/manual-activity-scan";
import { safeBack } from "@/lib/navigation";
import { ROLE_FILTER_ALL, ROLE_FILTER_OPTIONS } from "@/lib/role-filters";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { listScannerPeople } from "@/lib/scanner-db";
import type { ScannerPerson } from "@/lib/scanner-types";
import { isPadIdiom } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

export function PeopleDirectoryScreen() {
  const { activityId } = useLocalSearchParams<{ activityId?: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useNavigation();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const sync = useScannerSync();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"all" | ScannerPerson["role"]>("all");
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const usesListTitle = isPadIdiom();
  const glassAvailable = isRealLiquidGlassAvailable();
  const androidTopInset = useAndroidTopInset();
  const legacyTopInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
  const showInlineListTitle = usesListTitle && glassAvailable;
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const listRef = useRef<FlatList<ScannerPerson>>(null);

  useScrollToTop(listRef);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPeople(await listScannerPeople());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (sync.lastSync) void load();
  }, [load, sync.lastSync]);
  // Badge assignments/removals happen on the person detail screen, a
  // separate mounted instance with its own sync state — reload from SQLite
  // whenever this list regains focus so a just-applied change isn't stuck
  // showing stale data until this screen's own 15s sync tick catches up.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Deliberately not folding `sync.error` into this screen's own load error:
  // that reflects the background scan-queue sync (retried every 15s / on
  // app resume), whose transient failures shouldn't flash an error over an
  // already-loaded list. It gets its own banner below, and only appears
  // once auto-retry has actually given up (a single blip self-heals quietly
  // on the next tick) — see useScannerSync's autoRetryPaused.
  const loadError = error;
  const syncError = sync.autoRetryPaused ? sync.error : null;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await sync.sync();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error());
    } finally {
      setRefreshing(false);
    }
  }

  useLayoutEffect(() => {
    if (!glassAvailable) {
      navigation.setOptions({ headerShown: false });
      return;
    }
    navigation.setOptions({
      // Both entry points open the same people directory. Keep the screen
      // title stable; the search field already explains the available action.
      title: usesListTitle ? "" : t("scannerPeople"),
      // Large titles are an iOS-only presentation; the transparent native
      // header lets the list use UIKit's automatic inset and collapse the
      // title without painting a layer over it.
      headerLargeTitle: process.env.EXPO_OS === "ios" && !usesListTitle,
      headerTransparent: true,
      headerShadowVisible: false,
      headerSearchBarOptions: {
        placeholder: t("scannerPeopleSearchPlaceholder"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: false,
        // iOS 26 otherwise expands this into a full field on regular-width
        // iPads whenever UIKit decides there is enough trailing space.
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
      },
      headerRight: () => (
        <MenuView
          actions={ROLE_FILTERS.map((filter) => ({
            id: filter.value,
            title: t(filter.labelKey),
            image: filter.icon,
            state: roleFilter === filter.value ? "on" : "off",
          }))}
          onPressAction={({ nativeEvent }) => setRoleFilter(nativeEvent.event as typeof roleFilter)}
        >
          <SymbolView
            name={
              roleFilter === "all"
                ? "line.3.horizontal.decrease"
                : "line.3.horizontal.decrease.circle.fill"
            }
            tintColor={colors.accent}
            size={19}
          />
        </MenuView>
      ),
    });
  }, [glassAvailable, navigation, roleFilter, t, usesListTitle]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return people.filter((person) => {
      // An activity scan can only ever be logged against a badge, so this
      // list (unlike the plain scan directory, which lists everyone) only
      // shows people who already have one.
      if (activityId && !person.badgeId) return false;
      if (roleFilter !== "all" && person.role !== roleFilter) return false;
      if (!needle) return true;
      return [person.name, person.surname, person.email, person.badgeId, roleLabel(person.role, t)]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [people, query, roleFilter, activityId, t]);

  function openPerson(person: ScannerPerson) {
    if (activityId) {
      // Guaranteed by the `filtered` list above.
      emitManualActivityScan(Number(activityId), person.badgeId!);
      safeBack(router, {
        pathname: "/(tabs)/activities/[id]",
        params: { id: activityId },
      });
      return;
    }
    router.push({
      pathname: pathname.includes("/others/")
        ? "/(tabs)/others/person/[id]"
        : "/(tabs)/scan/person/[id]",
      params: { id: String(person.userId) },
    });
  }

  const legacyHeader = !glassAvailable ? (
    <LegacyScreenHeader
      actions={
        process.env.EXPO_OS === "android" ? (
          <GlassView
            colorScheme="auto"
            glassEffectStyle="regular"
            isInteractive
            style={{ borderRadius: 22, height: 44, width: 44 }}
          >
            <AndroidFilterMenu
              accessibilityLabel={t("scannerFilterGroups")}
              items={ROLE_FILTERS.map((filter) => ({
                id: filter.value,
                label: t(filter.labelKey),
                selected: roleFilter === filter.value,
              }))}
              onSelect={(id) => setRoleFilter(id as typeof roleFilter)}
            />
          </GlassView>
        ) : (
          <GlassView
            colorScheme="auto"
            glassEffectStyle="regular"
            isInteractive
            style={{ borderRadius: 22, height: 44, width: 44 }}
          >
            <MenuView
              actions={ROLE_FILTERS.map((filter) => ({
                id: filter.value,
                title: t(filter.labelKey),
                image: filter.icon,
                state: (roleFilter === filter.value ? "on" : "off") as "on" | "off",
              }))}
              onPressAction={({ nativeEvent }) =>
                setRoleFilter(nativeEvent.event as typeof roleFilter)
              }
            >
              <LegacyHeaderIconButton
                icon={
                  roleFilter === "all"
                    ? "line.3.horizontal.decrease"
                    : "line.3.horizontal.decrease.circle.fill"
                }
                accessibilityLabel={t("scannerFilterGroups")}
                accessibilityState={{ selected: roleFilter !== "all" }}
                tintColor={roleFilter === "all" ? colors.label : colors.accent}
                onPress={() => undefined}
              />
            </MenuView>
          </GlassView>
        )
      }
      cancelLabel={t("cancel")}
      leading={
        <LegacyHeaderIconButton
          icon="chevron.left"
          accessibilityLabel={t("back")}
          onPress={() =>
            safeBack(
              router,
              pathname.includes("/others/")
                ? "/(tabs)/others/account"
                : pathname.includes("/activities/")
                  ? "/(tabs)/activities"
                  : "/(tabs)/scan",
            )
          }
        />
      }
      onCloseSearch={() => {
        setSearchOpen(false);
        setQuery("");
      }}
      onOpenSearch={() => setSearchOpen(true)}
      onSearchQueryChange={setQuery}
      searchLabel={t("scheduleSearch")}
      searchOpen={searchOpen}
      searchPlaceholder={t("scannerPeopleSearchPlaceholder")}
      searchQuery={query}
      title={t("scannerPeople")}
      topInset={legacyTopInset}
    />
  ) : null;

  const list = (
    <FlatList
      ref={listRef}
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
        paddingHorizontal: 16,
      }}
      data={filtered}
      keyExtractor={(person) => String(person.userId)}
      ItemSeparatorComponent={() => <Separator inset={72} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      ListHeaderComponent={
        showInlineListTitle || (loadError && people.length > 0) || syncError ? (
          <View style={{ gap: 16, paddingBottom: showInlineListTitle ? 16 : 0, paddingTop: 8 }}>
            {showInlineListTitle ? (
              <Text style={{ color: colors.label, fontSize: 34, fontWeight: "700" }}>
                {t("scannerPeople")}
              </Text>
            ) : null}
            {loadError && people.length > 0 ? (
              <RequestFeedback
                error={loadError}
                message={t("requestError")}
                onRetry={() => void onRefresh()}
                retrying={loading || refreshing || sync.syncing}
              />
            ) : null}
            {syncError ? (
              <RequestFeedback
                error={new Error(syncError.message)}
                message={t(syncError.conflict ? "scannerSyncRejected" : "scannerSyncFailed")}
                onRetry={() => void sync.sync()}
                retrying={sync.syncing}
              />
            ) : null}
          </View>
        ) : null
      }
      ListEmptyComponent={
        loading ? (
          <RequestFeedback loading />
        ) : loadError && people.length === 0 ? (
          <RequestFeedback
            error={loadError}
            message={t("requestError")}
            onRetry={() => void onRefresh()}
            retrying={loading || refreshing || sync.syncing}
          />
        ) : (
          <EmptyState
            icon="person.2"
            title={query ? t("scannerNoResults") : t("scannerNoSyncedUsers")}
            description={query ? t("scannerTryAnotherSearch") : t("scannerRefreshDirectory")}
          />
        )
      }
      renderItem={({ item }) => <PersonRow person={item} onPress={() => openPerson(item)} />}
    />
  );

  if (glassAvailable) return list;
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {legacyHeader}
      {list}
    </View>
  );
}

const ROLE_FILTERS: Array<{
  value: "all" | ScannerPerson["role"];
  labelKey: "roleAll" | (typeof ROLE_FILTER_OPTIONS)[number]["labelKey"];
  icon: "person.2" | (typeof ROLE_FILTER_OPTIONS)[number]["icon"];
}> = [{ value: "all", ...ROLE_FILTER_ALL }, ...ROLE_FILTER_OPTIONS];

function PersonRow({ person, onPress }: { person: ScannerPerson; onPress: () => void }) {
  const { t } = useLocale();
  const fullName = [person.name, person.surname].filter(Boolean).join(" ");
  const displayName = fullName || person.email;
  // Only shown as its own line when it isn't already standing in for the
  // name above (someone with no name on file at all).
  const showEmailLine = Boolean(fullName) && Boolean(person.email);
  const participantWarning =
    person.role === "unassigned" || (person.role === "participant" && !person.accepted)
      ? { label: t("scannerNoAcceptedPlace"), tone: "destructive" as const }
      : person.role === "participant" && !person.confirmed
        ? { label: t("scannerPlaceUnconfirmed"), tone: "warning" as const }
        : null;

  return (
    <Pressable
      accessibilityHint={t("scannerViewPerson")}
      accessibilityLabel={[
        displayName,
        showEmailLine ? person.email : null,
        roleLabel(person.role, t),
        person.badgeId ?? t("scannerNoBadge"),
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.elevatedSurface : colors.background,
        flexDirection: "row",
        gap: 12,
        minHeight: participantWarning ? 98 : 84,
        paddingHorizontal: 16,
        paddingVertical: 9,
      })}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.accentSurface,
          borderRadius: 999,
          height: 40,
          justifyContent: "center",
          width: 40,
        }}
      >
        <SymbolView
          name="person.fill"
          tintColor={colors.onAccentSurface}
          size={18}
          accessible={false}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          selectable
          style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}
        >
          {displayName}
        </Text>
        {showEmailLine ? (
          <Text
            numberOfLines={1}
            selectable
            style={{ color: colors.tertiaryLabel, fontSize: 13, fontWeight: "400" }}
          >
            {person.email}
          </Text>
        ) : null}
        <Text numberOfLines={1} selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
          {roleLabel(person.role, t)} · {person.badgeId ?? t("scannerNoBadge")}
        </Text>
        {participantWarning ? (
          <View style={{ alignItems: "center", flexDirection: "row", gap: 5 }}>
            <SymbolView
              name="exclamationmark.circle.fill"
              tintColor={colors.destructive}
              size={13}
              accessible={false}
            />
            <Text
              numberOfLines={1}
              selectable
              style={{ color: colors.destructive, fontSize: 13, fontWeight: "600" }}
            >
              {participantWarning.label}
            </Text>
          </View>
        ) : null}
      </View>
      <SymbolView name="chevron.right" tintColor={colors.tertiaryLabel} size={14} />
    </Pressable>
  );
}

function roleLabel(role: ScannerPerson["role"], t: ReturnType<typeof useLocale>["t"]) {
  return (
    {
      admin: t("roleAdmin"),
      staff: t("roleStaff"),
      sponsor: t("roleSponsor"),
      mentor: t("roleMentor"),
      judge: t("roleJudge"),
      participant: t("roleParticipant"),
      unassigned: t("roleUnassigned"),
    } as const
  )[role];
}
