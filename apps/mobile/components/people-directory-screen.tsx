import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  usePathname,
  useRouter,
} from "expo-router";
import Stack from "expo-router/stack";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FlatList, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { FilterMenu } from "@/components/filter-menu";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EntryBackToolbar } from "@/components/header-back-button";
import {
  EmptyState,
  LegacyHeaderIconButton,
  LegacyScreenHeader,
  Separator,
} from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { emitManualActivityScan } from "@/lib/manual-activity-scan";
import { safeBack } from "@/lib/navigation";
import { filterMenuBarItem, withBarGaps } from "@/lib/pane-header-items";
import {
  ROLE_FILTER_ALL_ICON,
  roleDisplayName,
  roleFilterOptionsFromRoster,
} from "@/lib/role-filters";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { collapseProgress } from "@/lib/scan-pane";
import { listScannerPeople } from "@/lib/scanner-db";
import type { ScannerPerson } from "@/lib/scanner-types";
import { isPadIdiom } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { isSyncConflict, useScannerSync } from "@/lib/use-scanner";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors, radius, type } from "@/theme";
import { isAccessibilityTextSize } from "@/theme/dynamic-type";
import { useOperatorListColumn } from "@/theme/layout-screens";

/**
 * The people finder. As a route it owns its native header. `embedded` (inside
 * `PeopleFinderPane`, over a two-pane scanner) draws the same filter menu and search as the
 * legacy header in ONE row, led by a back item named `backLabel` that calls `onClose`, and a pick
 * goes to `onSelect` instead of navigating. `requireBadge` lists only people who hold a badge
 * (an activity scan can only use a badge).
 */
export function PeopleDirectoryScreen({
  backLabel,
  embedded = false,
  headerTopInset = 0,
  nativeHeader = false,
  onClose,
  onSelect,
  requireBadge = false,
}: {
  backLabel?: string;
  embedded?: boolean;
  /** Space above the embedded header row. */
  headerTopInset?: number;
  /** Inside a native stack (`pane-people-stack.ios.tsx`): the stack's bar is the header. */
  nativeHeader?: boolean;
  onClose?: () => void;
  onSelect?: (person: ScannerPerson) => void;
  requireBadge?: boolean;
} = {}) {
  const listColumn = useOperatorListColumn();
  const { activityId, autoSearch } = useLocalSearchParams<{
    activityId?: string;
    /** Set by the scanner's "search participants" entry point (H22-H26) so the
     *  legacy (non-Liquid-Glass) header opens straight into search with the
     *  keyboard up, instead of landing on the plain title + a search icon the
     *  operator has to tap first. iOS's native `headerSearchBarOptions` bar
     *  below isn't driven by `searchOpen`, so this has no effect there. */
    autoSearch?: string;
  }>();
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useNavigation();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const sync = useScannerSync();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(autoSearch === "1");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [people, setPeople] = useState<ScannerPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const usesListTitle = isPadIdiom();
  const glassAvailable = isRealLiquidGlassAvailable();
  const androidTopInset = useAndroidTopInset();
  const legacyTopInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
  // The panel keeps the standalone iPad large title: it scrolls away while the header's inline
  // title fades in.
  // Exactly one title: in the pane's native stack the bar's large title (collapsing into the
  // inline one) is the only provider, so no list-header title is drawn there.
  const showInlineListTitle = !nativeHeader && (embedded || (usesListTitle && glassAvailable));
  const ownHeader = !nativeHeader && (embedded || !glassAvailable);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const listRef = useRef<FlatList<ScannerPerson>>(null);
  const scrollY = useSharedValue(0);
  const titleFade = useDerivedValue(() => collapseProgress(scrollY.get()));
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });

  // SQLite is an offline backup. Once an online sync has a response, prefer
  // that snapshot even if the local roster could not be opened or written.
  const directory = sync.serverSnapshot?.people ?? people;

  const trueTop = useTrueTopScroll(listRef);

  const roleFilters = useMemo(() => {
    const options = roleFilterOptionsFromRoster(directory, (role) => roleDisplayName(role, t));
    return [{ value: "all" as const, label: t("roleAll"), icon: ROLE_FILTER_ALL_ICON }, ...options];
  }, [directory, t]);

  const selectRole = useCallback((id: string) => {
    setSelectedRoles((current) =>
      id === "all"
        ? []
        : current.includes(id)
          ? current.filter((role) => role !== id)
          : [...current, id],
    );
  }, []);
  const filterItems = useMemo(
    () =>
      roleFilters.map((filter) => ({
        id: filter.value,
        label: filter.label,
        icon: filter.icon,
        selected:
          filter.value === "all"
            ? selectedRoles.length === 0
            : selectedRoles.includes(filter.value),
      })),
    [roleFilters, selectedRoles],
  );
  const filterMenu = useMemo(
    () => (
      <FilterMenu
        accessibilityLabel={t("scannerFilterGroups")}
        active={selectedRoles.length > 0}
        items={filterItems}
        onSelect={selectRole}
      />
    ),
    [filterItems, selectRole, selectedRoles.length, t],
  );

  // The same filter as a real bar item, for the pane's native stack.
  const filterBarItem = useMemo(
    () =>
      filterMenuBarItem({
        accessibilityLabel: t("scannerFilterGroups"),
        active: selectedRoles.length > 0,
        onSelect: selectRole,
        rows: filterItems,
      }),
    [filterItems, selectRole, selectedRoles.length, t],
  );

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
  const loadError = sync.serverSnapshot ? null : error;
  const syncError = sync.autoRetryPaused ? sync.error : null;

  async function onRefresh() {
    setRefreshing(true);
    try {
      await sync.sync();
      // The online snapshot is the source of truth and updates the list
      // directly. Local reload is best-effort and is already attempted by the
      // sync hook; do not keep pull-to-refresh spinning on a broken cache.
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error());
    } finally {
      setRefreshing(false);
    }
  }

  useLayoutEffect(() => {
    if (nativeHeader) {
      // The pane's own native stack: the standalone People configuration, with the filter as the
      // trailing bar item and the back item named after the pane it covers.
      navigation.setOptions({
        headerBackTitle: backLabel,
        headerLargeTitle: true,
        // Its own bar item: iOS 26 would otherwise merge it with the search into one capsule.
        unstable_headerRightItems: () => withBarGaps([filterBarItem]),
        headerSearchBarOptions: {
          placeholder: t("scannerPeopleSearchPlaceholder"),
          autoCapitalize: "none",
          hideWhenScrolling: true,
          allowToolbarIntegration: false,
          placement: "integratedButton",
          onChangeText: (event: { nativeEvent: { text: string } }) =>
            setQuery(event.nativeEvent.text),
        },
        headerShadowVisible: false,
        headerTransparent: true,
        title: t("scannerPeople"),
      });
      return;
    }
    // Embedded, the host screen owns the header options.
    if (embedded) return;
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
      headerRight: undefined,
    });
  }, [
    backLabel,
    embedded,
    filterBarItem,
    glassAvailable,
    nativeHeader,
    navigation,
    t,
    usesListTitle,
  ]);

  const filtered = useMemo(() => {
    const needle = query.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    return directory.filter((person) => {
      // An activity scan can only ever be logged against a badge, so this
      // list (unlike the plain scan directory, which lists everyone) only
      // shows people who already have one.
      if ((activityId || requireBadge) && !person.badgeId) return false;
      if (
        selectedRoles.length > 0 &&
        (person.role === null || !selectedRoles.includes(person.role))
      )
        return false;
      if (!needle) return true;
      return [
        person.name,
        person.surname,
        person.email,
        person.badgeId,
        person.dni,
        roleDisplayName(person.role, t),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [directory, query, selectedRoles, activityId, requireBadge, t]);

  const openPerson = useCallback(
    (person: ScannerPerson) => {
      if (activityId) {
        // Guaranteed by the `filtered` list above.
        emitManualActivityScan(Number(activityId), person.badgeId!);
        safeBack(router, {
          pathname: "/activities/[id]",
          params: { id: activityId },
        });
        return;
      }
      if (embedded && onSelect) {
        onSelect(person);
        return;
      }
      router.push({
        pathname: pathname.includes("/others/") ? "/others/person/[id]" : "/scan/person/[id]",
        params: { id: String(person.userId) },
      });
    },
    [activityId, embedded, onSelect, pathname, router],
  );

  const renderPersonRow = useCallback(
    ({ item }: { item: ScannerPerson }) => <PersonRow person={item} onPress={openPerson} />,
    [openPerson],
  );

  const legacyHeader = ownHeader ? (
    <LegacyScreenHeader
      actions={filterMenu}
      cancelLabel={t("cancel")}
      leading={
        embedded ? (
          // The same circular glass chevron as the other legacy headers, closing the panel.
          <View style={{ alignItems: "center", height: 48, justifyContent: "center", width: 48 }}>
            <GlassView
              colorScheme="auto"
              glassEffectStyle="regular"
              isInteractive
              style={{ borderRadius: radius.full, height: 44, width: 44 }}
            >
              <LegacyHeaderIconButton
                icon="chevron.left"
                accessibilityLabel={backLabel ?? t("back")}
                onPress={() => onClose?.()}
              />
            </GlassView>
          </View>
        ) : (
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
        )
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
      inlineTitle={embedded}
      titleFade={embedded ? titleFade : undefined}
      title={t("scannerPeople")}
      topInset={embedded ? headerTopInset : legacyTopInset}
    />
  ) : null;

  // Embedded, the list reports its scroll to the UI thread to collapse the large title.
  const ListComponent = (
    embedded && !nativeHeader ? Animated.FlatList : FlatList
  ) as typeof FlatList;
  const list = (
    <ListComponent
      ref={listRef}
      {...trueTop.scrollProps}
      contentInsetAdjustmentBehavior={embedded && !nativeHeader ? "never" : "automatic"}
      style={{ backgroundColor: colors.background, flex: 1 }}
      {...(embedded && !nativeHeader
        ? {
            keyboardDismissMode: "on-drag" as const,
            keyboardShouldPersistTaps: "handled" as const,
            onScroll: scrollHandler,
            scrollEventThrottle: 16,
          }
        : null)}
      contentContainerStyle={{
        ...listColumn,
        flexGrow: 1,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
      data={filtered}
      keyExtractor={(person) => String(person.userId)}
      ItemSeparatorComponent={() => <Separator inset={72} />}
      refreshControl={
        <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
      ListHeaderComponent={
        showInlineListTitle || (loadError && directory.length > 0) || syncError ? (
          <View style={{ gap: 16, paddingBottom: showInlineListTitle ? 16 : 0, paddingTop: 8 }}>
            {showInlineListTitle ? (
              <Text
                style={{
                  color: colors.label,
                  fontSize: type.largeTitle.fontSize,
                  fontWeight: "700",
                }}
              >
                {t("scannerPeople")}
              </Text>
            ) : null}
            {loadError && directory.length > 0 ? (
              <RequestFeedback
                error={loadError}
                message={t("requestError")}
                onRetry={() => void onRefresh()}
                retrying={loading || refreshing || sync.syncing}
              />
            ) : null}
            {syncError && isSyncConflict(syncError) ? (
              <RequestFeedback
                error={new Error(syncError.message)}
                message={t("scannerSyncRejected")}
                onRetry={() => void sync.sync()}
                retrying={sync.syncing}
              />
            ) : null}
            {syncError && !isSyncConflict(syncError) ? (
              <StaleDataBanner updatedAt={sync.lastSync} />
            ) : null}
          </View>
        ) : null
      }
      ListEmptyComponent={
        loading ? (
          <RequestFeedback loading />
        ) : loadError && directory.length === 0 ? (
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
      renderItem={renderPersonRow}
    />
  );

  // In the pane's native stack the list is the screen's own root scroll view (no wrapping View),
  // so UIKit collapses the large title and draws the scroll-edge blur as it scrolls.
  if (nativeHeader) return list;
  if (glassAvailable && !embedded)
    return (
      <>
        {list}
        <EntryBackToolbar fallback="/(tabs)/others/account" />
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.View hidesSharedBackground>{filterMenu}</Stack.Toolbar.View>
        </Stack.Toolbar>
      </>
    );
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {legacyHeader}
      {list}
    </View>
  );
}

const PersonRow = memo(function PersonRow({
  person,
  onPress,
}: {
  person: ScannerPerson;
  onPress: (person: ScannerPerson) => void;
}) {
  const accessibilityText = isAccessibilityTextSize(useWindowDimensions().fontScale);
  const { t } = useLocale();
  const fullName = [person.name, person.surname].filter(Boolean).join(" ");
  const displayName = fullName || person.email;
  // Only shown as its own line when it isn't already standing in for the
  // name above (someone with no name on file at all).
  const showEmailLine = Boolean(fullName) && Boolean(person.email);
  const participantWarning = !person.eventAccess
    ? { label: t("scannerNoEventAccess"), tone: "destructive" as const }
    : null;

  return (
    <PressableFeedback
      accessibilityHint={t("scannerViewPerson")}
      accessibilityLabel={[
        displayName,
        showEmailLine ? person.email : null,
        roleDisplayName(person.role, t),
        person.badgeId ?? t("scannerNoBadge"),
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole="button"
      feedback="row"
      onPress={() => onPress(person)}
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flexDirection: "row",
        gap: 12,
        minHeight: participantWarning ? 98 : 84,
        paddingHorizontal: 16,
        paddingVertical: 9,
      }}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.accentSurface,
          borderRadius: radius.full,
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
          numberOfLines={accessibilityText ? undefined : 1}
          selectable
          style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
        >
          {displayName}
        </Text>
        {showEmailLine ? (
          <Text
            numberOfLines={1}
            selectable
            style={{
              color: colors.tertiaryLabel,
              fontSize: type.footnote.fontSize,
              fontWeight: "400",
            }}
          >
            {person.email}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          selectable
          style={{ color: colors.secondaryLabel, fontSize: type.compact.fontSize }}
        >
          {roleDisplayName(person.role, t)} · {person.badgeId ?? t("scannerNoBadge")}
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
              numberOfLines={accessibilityText ? undefined : 1}
              selectable
              style={{
                color: colors.destructive,
                fontSize: type.footnote.fontSize,
                fontWeight: "600",
              }}
            >
              {participantWarning.label}
            </Text>
          </View>
        ) : null}
      </View>
      <SymbolView name="chevron.right" tintColor={colors.tertiaryLabel} size={14} />
    </PressableFeedback>
  );
});
