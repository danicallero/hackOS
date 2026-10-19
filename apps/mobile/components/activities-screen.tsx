import { isMealActivityKind } from "@hackos/shared/activity-kinds";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FilterMenu } from "@/components/filter-menu";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EmptyState, LegacyScreenHeader, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import {
  activityKinds,
  closestActivity,
  filterActivities,
  sameActivities,
} from "@/lib/activity-list";
import { formatEventTime, useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { listScannerActivities } from "@/lib/scanner-db";
import { resolveActivityText, type ScannerActivity } from "@/lib/scanner-types";
import { activityKindSymbol, scheduleTypeLabel } from "@/lib/schedule";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { isSyncConflict, useScannerSync } from "@/lib/use-scanner";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";
import { SCREEN_TITLE } from "@/theme/screen-title";

/** How often the "Now"/"Next" marker re-evaluates which row it belongs to. */
const MARKER_TICK_MS = 60_000;

export function ActivitiesScreen() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { language, t } = useLocale();
  const insets = useSafeAreaInsets();
  const sync = useScannerSync();
  const [items, setItems] = useState<ScannerActivity[]>([]);
  const [query, setQuery] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<Error | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const listRef = useRef<FlatList<ScannerActivity>>(null);
  const returningFromScanner = useRef(false);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const glassAvailable = isRealLiquidGlassAvailable();
  const androidTopInset = useAndroidTopInset();
  const legacyTopInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
  // SQLite is an offline backup. A successful online snapshot must replace
  // the list immediately, even when the local roster cannot be opened.
  const directory = sync.serverSnapshot?.activities ?? items;
  const scannableDirectory = useMemo(
    () => directory.filter((item) => item.requiresScan || isMealActivityKind(item.category)),
    [directory],
  );

  const trueTop = useTrueTopScroll(listRef);

  const load = useCallback(async () => {
    try {
      const next = (await listScannerActivities()).filter(
        (item) => item.requiresScan || isMealActivityKind(item.category),
      );
      // Committing a fresh array on every 15s sync tick re-rendered every row
      // and bounced the scroll offset back under the large title, which read
      // as the list flickering on its own. Only swap it in when it changed.
      setItems((current) => (sameActivities(current, next) ? current : next));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error());
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await sync.sync();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error());
    } finally {
      setRefreshing(false);
    }
  }, [sync.sync]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (sync.lastSync) void load();
  }, [load, sync.lastSync]);

  // Keeps the marker on the right row as the event moves on, without
  // reloading anything.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), MARKER_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Deliberately not folding `sync.error` into this screen's own load error:
  // that reflects the background scan-queue sync (retried every 15s / on
  // app resume), whose transient failures shouldn't flash an error over an
  // already-loaded list. It gets its own banner below, and only appears
  // once auto-retry has actually given up (a single blip self-heals quietly
  // on the next tick) — see useScannerSync's autoRetryPaused.
  const loadError = sync.serverSnapshot ? null : error;
  const syncError = sync.autoRetryPaused ? sync.error : null;
  // A server snapshot is already usable while the disposable local backup is
  // still opening (or is stuck behind a native SQLite lock). Do not leave an
  // authoritative empty response looking like an endless loading spinner.
  const listLoading = loading && !sync.serverSnapshot;

  const kinds = useMemo(() => activityKinds(scannableDirectory), [scannableDirectory]);
  const filtered = useMemo(
    () => filterActivities(scannableDirectory, { query, kinds: selectedKinds }),
    [scannableDirectory, selectedKinds, query],
  );
  const marker = useMemo(() => closestActivity(filtered, now), [filtered, now]);
  const filtering = query.trim().length > 0 || selectedKinds.length > 0;

  const selectKind = useCallback((id: string) => {
    setSelectedKinds((current) =>
      id === "all"
        ? []
        : current.includes(id)
          ? current.filter((kind) => kind !== id)
          : [...current, id],
    );
  }, []);
  const filterItems = useMemo(
    () => [
      { id: "all", label: t("scheduleFilterAll"), selected: selectedKinds.length === 0 },
      ...kinds.map((value) => ({
        id: value,
        label: scheduleTypeLabel(value, t),
        icon: activityKindSymbol(value),
        selected: selectedKinds.includes(value),
      })),
    ],
    [kinds, selectedKinds, t],
  );
  const filterMenu = useMemo(
    () => (
      <FilterMenu
        accessibilityLabel={t("scheduleFilter")}
        active={selectedKinds.length > 0}
        items={filterItems}
        onSelect={selectKind}
      />
    ),
    [filterItems, selectKind, selectedKinds.length, t],
  );

  // This is intentionally the same native composition as Schedule. In
  // particular, the search affordance must remain `headerSearchBarOptions`;
  // putting a magnifying-glass Pressable inside GlassView produces a static
  // surface on iOS 26 and loses UIKit's Liquid Glass search transition.
  useLayoutEffect(() => {
    const headerRight = () => filterMenu;

    if (!glassAvailable) {
      // Keep the options available to the fallback/native test harness while
      // the actual visible control is LegacyScreenHeader below.
      navigation.setOptions({
        headerShown: false,
        headerRight,
        headerSearchBarOptions: {
          placeholder: t("scannerActivitiesSearchPlaceholder"),
          autoCapitalize: "none",
          hideWhenScrolling: true,
          allowToolbarIntegration: false,
          placement: "integratedButton",
          onChangeText: (event: { nativeEvent: { text: string } }) =>
            setQuery(event.nativeEvent.text),
        },
      });
      return;
    }

    navigation.setOptions({
      // The compact title is supplied by the native left toolbar below. An
      // empty navigation title prevents iOS 26 from inserting its centred
      // fallback title when this screen has only one trailing action.
      title: "",
      headerShown: true,
      headerLargeTitle: false,
      headerTransparent: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.background },
      headerTitleAlign: "left",
      headerTitleStyle: { color: colors.label, ...SCREEN_TITLE },
      headerSearchBarOptions: {
        placeholder: t("scannerActivitiesSearchPlaceholder"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: false,
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
      },
    });
  }, [glassAvailable, filterMenu, navigation, t]);

  // Forces the FlatList back to the top on focus so the native large-title
  // header re-syncs its collapsed/expanded state with the actual scroll
  // offset — otherwise entering this tab fresh can leave the header (and
  // therefore the list start) stuck lower than it should be. Skipped when
  // coming back from the pushed scanner screen, so that back-navigation
  // preserves wherever the list was scrolled to.
  useFocusEffect(
    useCallback(() => {
      if (!returningFromScanner.current) {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      }
      returningFromScanner.current = false;
    }, []),
  );

  const onActivityPress = useCallback(
    (item: ScannerActivity) => {
      returningFromScanner.current = true;
      router.push({
        pathname: "/activities/[id]",
        params: { id: String(item.id) },
      });
    },
    [router],
  );

  const renderActivityRow = useCallback(
    ({ item }: { item: ScannerActivity }) => (
      <ActivityRow
        item={item}
        language={language}
        marker={marker?.id === item.id ? (marker.running ? "now" : "next") : null}
        t={t}
        onPress={onActivityPress}
      />
    ),
    [language, marker, onActivityPress, t],
  );

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {glassAvailable ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.View hidesSharedBackground>
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
                style={{
                  // A fixed colour, not the dynamic label: iOS 26 flips a bar
                  // item's light/dark appearance with what scrolls behind it,
                  // which turned the title white for a moment.
                  color: colorScheme === "dark" ? "#ffffff" : "#000000",
                  fontSize: 28,
                  fontWeight: "800",
                }}
              >
                {t("tabActivities")}
              </Text>
            </Stack.Toolbar.View>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.View hidesSharedBackground>{filterMenu}</Stack.Toolbar.View>
          </Stack.Toolbar>
        </>
      ) : (
        <LegacyScreenHeader
          actions={filterMenu}
          cancelLabel={t("cancel")}
          onCloseSearch={() => {
            setSearchOpen(false);
            setQuery("");
          }}
          onOpenSearch={() => setSearchOpen(true)}
          onSearchQueryChange={setQuery}
          searchLabel={t("scheduleSearch")}
          searchOpen={searchOpen}
          searchPlaceholder={t("scannerActivitiesSearchPlaceholder")}
          searchQuery={query}
          title={t("tabActivities")}
          topInset={legacyTopInset}
        />
      )}
      <FlatList
        ref={listRef}
        {...trueTop.scrollProps}
        style={{ flex: 1 }}
        testID="activities-list"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          padding: 16,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
        }}
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        keyboardDismissMode="on-drag"
        // Only a pull-to-refresh drives this spinner. Wiring it to `sync.syncing`
        // made the background 15s tick yank the list open under the header on
        // its own (H59).
        refreshControl={<RefreshControl onRefresh={() => void refresh()} refreshing={refreshing} />}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListHeaderComponent={
          (loadError && scannableDirectory.length > 0) || syncError ? (
            <View style={{ gap: 8, paddingBottom: 12 }}>
              {loadError && scannableDirectory.length > 0 ? (
                <RequestFeedback
                  error={loadError}
                  message={t("requestError")}
                  onRetry={() => void refresh()}
                  retrying={loading || refreshing}
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
          listLoading ? (
            <RequestFeedback loading />
          ) : loadError ? (
            <RequestFeedback
              error={loadError}
              message={t("requestError")}
              onRetry={() => void refresh()}
              retrying={loading || refreshing}
            />
          ) : filtering ? (
            <EmptyState
              icon="magnifyingglass"
              title={t("scannerActivitiesNoMatches")}
              description={t("scannerActivitiesNoMatchesBody")}
            />
          ) : (
            <EmptyState
              icon="wave.3.right"
              title={t("scannerActivitiesEmpty")}
              description={t("scannerActivitiesEmptyBody")}
            />
          )
        }
        renderItem={renderActivityRow}
      />
    </View>
  );
}

const ActivityRow = memo(function ActivityRow({
  item,
  language,
  marker,
  onPress,
  t,
}: {
  item: ScannerActivity;
  language: ScannerActivity["primaryLanguage"];
  /** "now" on the activity currently running, "next" on the one about to start. */
  marker: "now" | "next" | null;
  onPress: (item: ScannerActivity) => void;
  t: ReturnType<typeof useLocale>["t"];
}) {
  useEventTimeZone();
  const startsAt = item.startsAt ? new Date(item.startsAt) : null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(item)}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.elevatedSurface,
        borderColor: marker ? colors.accent : colors.transparent,
        borderCurve: "continuous",
        borderRadius: 999,
        borderWidth: marker ? 1.5 : 0,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
        flexDirection: "row",
        gap: 12,
        minHeight: 64,
        opacity: pressed ? 0.65 : 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
      })}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.accentSurface,
          borderRadius: 999,
          height: 42,
          justifyContent: "center",
          width: 42,
        }}
      >
        <SymbolView
          // The scanner's activities mirror their schedule item's category, so
          // the icon comes from the shared kind registry; a category this build
          // doesn't know (older rows, retired kinds) keeps the generic list icon.
          name={activityKindSymbol(item.category, "list.bullet.rectangle")}
          tintColor={colors.onAccentSurface}
          size={22}
        />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          selectable
          numberOfLines={1}
          style={{ color: colors.label, fontSize: 17, fontWeight: "700" }}
        >
          {resolveActivityText(item, language)}
        </Text>
        {startsAt || marker ? (
          <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
            {marker ? (
              <Text style={{ color: colors.accent, fontSize: 13, fontWeight: "700" }}>
                {marker === "now" ? t("scheduleNow") : t("scannerActivitiesNext")}
              </Text>
            ) : null}
            {startsAt ? (
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.secondaryLabel, fontSize: 13 }}
              >
                {formatEventTime(startsAt, language, {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      <StatusPill
        tone={isMealActivityKind(item.category) ? "warning" : "accent"}
        style={{ alignSelf: "center" }}
      >
        {scheduleTypeLabel(item.category, t)}
      </StatusPill>
      <SymbolView name="chevron.right" tintColor={colors.tertiaryLabel} size={15} />
    </Pressable>
  );
});
