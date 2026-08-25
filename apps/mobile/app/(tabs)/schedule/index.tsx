import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  type ColorValue,
  type GestureResponderEvent,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EmptyState, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { type AudienceFilterValue, ScheduleFilterPanel } from "@/components/schedule-filter-button";
import {
  ScheduleFormModal,
  scheduleItemToForm,
  scheduleItemToTranslations,
} from "@/components/schedule-form-modal";
import { ScheduleNotificationsSheet } from "@/components/schedule-notifications-sheet";
import { ScheduleSwipeRow } from "@/components/schedule-swipe-row";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  useRouterTabBarBottomInset,
  useRouterTabBarScrollBottomInset,
} from "@/lib/router-tabs-inset";
import {
  type AdminScheduleItem,
  addScheduleOwner,
  createScheduleItem,
  deleteScheduleItem,
  fetchAdminSchedule,
  fetchPublicSchedule,
  resolveScheduleText,
  type ScheduleInput,
  type ScheduleItem,
  scheduleTypeLabel,
  updateScheduleItem,
  upsertScheduleItem,
} from "@/lib/schedule";
import { has } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { itemCategory, useScheduleNotifications } from "@/lib/use-schedule-notifications";
import { colors } from "@/theme/colors";

type NowMarker = { kind: "now"; id: string };
type ItemRow = ScheduleItem & { kind: "item"; active: boolean };
type SectionRow = ItemRow | NowMarker;

interface ScheduleSection {
  key: string;
  title: string;
  data: SectionRow[];
}

const SECTION_HEADER_HEIGHT = 34;
// Size + placement of the floating "add" button — the list's own bottom
// padding reserves this much space so its last card never renders behind it.
const FAB_SIZE = 52;
const FAB_MARGIN = 24;
// Short clearance above the tab bar: enough to keep the FAB tappable without
// making it float far up into the schedule content.
const FAB_BOTTOM_OFFSET = 4;

function audienceMatches(item: ScheduleItem, selected: AudienceFilterValue[]): boolean {
  if (selected.length === 0) return true;
  if (item.audiences.length === 0) return selected.includes("staff");
  return item.audiences.some((audience) => selected.includes(audience));
}

/** `query` is already trimmed and lowercased by the caller. */
function scheduleItemMatchesQuery(item: ScheduleItem, query: string): boolean {
  return (
    item.title.toLowerCase().includes(query) ||
    (item.description?.toLowerCase().includes(query) ?? false) ||
    (item.location?.toLowerCase().includes(query) ?? false)
  );
}

/** Participant schedule backed by the same public read model used on web. */
export default function ScheduleScreen() {
  useColorScheme();
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<SectionList<SectionRow, ScheduleSection>>(null);
  const scrolledOnLoad = useRef(false);
  const scrollRetries = useRef(0);
  const scrollRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAnimated = useRef(false);
  const navigation = useNavigation();
  const tabNavigation = navigation.getParent?.();
  const insets = useSafeAreaInsets();
  const tabBarBottomInset = useRouterTabBarBottomInset();
  const tabBarScrollBottomInset = useRouterTabBarScrollBottomInset();
  const canManage = has(me?.capabilities ?? [], CAPABILITIES.SCHEDULE_MANAGE);

  const { data, loading, error, staleSince, load, setData } = useCachedApi(
    "schedule",
    fetchPublicSchedule,
  );
  // H50 extension: resolve each item's title/description into the viewer's
  // language here so every downstream renderer keeps reading plain
  // item.title/item.description unchanged.
  const items = useMemo(
    () => (data ?? []).map((item) => ({ ...item, ...resolveScheduleText(item, language) })),
    [data, language],
  );
  const notifications = useScheduleNotifications(items);

  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [selectedAudiences, setSelectedAudiences] = useState<AudienceFilterValue[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [legacySearchOpen, setLegacySearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formTarget, setFormTarget] = useState<"create" | ScheduleItem | null>(null);

  const filterActive = selectedKinds.length > 0 || selectedAudiences.length > 0;
  // Real Liquid Glass (iOS 26+) gets the native header below: the OS owns the
  // toolbar grouping and integrated search behavior. Earlier iOS and Android
  // keep the original hand-rolled header because it supports the shared
  // action pill and in-place search expansion.
  const glassAvailable = isRealLiquidGlassAvailable();
  const androidTopInset = useAndroidTopInset();
  const legacyTopInset = process.env.EXPO_OS === "ios" ? insets.top : androidTopInset;
  const filterAnchor = glassAvailable
    ? { top: insets.top + 52, right: 16 }
    : { top: legacyTopInset + 60, right: 16 };

  // Keep the native search on the glass path. The custom header below is the
  // fallback for platforms where the native header cannot express the old
  // compact action/search layout.
  useLayoutEffect(() => {
    if (!glassAvailable) {
      navigation.setOptions({ headerShown: false });
      return;
    }
    navigation.setOptions({
      title: t("tabSchedule"),
      headerShown: true,
      headerLargeTitle: false,
      headerTransparent: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.background },
      headerTitleAlign: "left",
      headerTitleStyle: { color: colors.label, fontSize: 28, fontWeight: "800" },
      headerSearchBarOptions: {
        placeholder: t("scheduleSearchPlaceholder"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: false,
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setSearchQuery(event.nativeEvent.text),
      },
    });
  }, [navigation, t, glassAvailable]);

  useEffect(() => {
    void load();
    void notifications.load();
  }, [load, notifications.load]);

  // Keeps the "now" line accurate without a full data reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const kinds = useMemo(
    () =>
      [
        ...new Set(items.map((item) => item.type).filter((type): type is string => Boolean(type))),
      ].sort(),
    [items],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          (selectedKinds.length === 0 || (item.type && selectedKinds.includes(item.type))) &&
          audienceMatches(item, selectedAudiences) &&
          (normalizedQuery === "" || scheduleItemMatchesQuery(item, normalizedQuery)),
      ),
    [items, selectedKinds, selectedAudiences, normalizedQuery],
  );

  const todayKey = useMemo(() => new Date(now).toLocaleDateString("en-CA"), [now]);

  const sections = useMemo<ScheduleSection[]>(() => {
    const grouped = new Map<string, ScheduleItem[]>();
    for (const item of [...filteredItems].sort(
      (a, b) => safeTimestamp(a.startsAt) - safeTimestamp(b.startsAt),
    )) {
      const key = new Date(item.startsAt).toLocaleDateString("en-CA");
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].map(([key, dayItems]) => {
      const activeItemIndex =
        key === todayKey
          ? dayItems.findIndex(
              (item) => safeTimestamp(item.startsAt) <= now && safeTimestamp(item.endsAt) >= now,
            )
          : -1;
      const rows: SectionRow[] = dayItems.map((item, index) => ({
        ...item,
        kind: "item" as const,
        active: Platform.OS !== "web" && index === activeItemIndex,
      }));
      if (key === todayKey && activeItemIndex === -1) {
        const markerIndex = dayItems.findIndex((item) => safeTimestamp(item.startsAt) > now);
        const insertAt = markerIndex === -1 ? rows.length : markerIndex;
        rows.splice(insertAt, 0, { kind: "now", id: "now-marker" });
      }
      return {
        key,
        data: rows,
        title: new Date(dayItems[0].startsAt).toLocaleDateString(language, {
          weekday: "long",
          month: "long",
          day: "numeric",
        }),
      };
    });
  }, [filteredItems, language, now, todayKey]);

  // Jumps straight to "what's happening now" (or the marker between cards)
  // instead of opening at the beginning of a multi-day schedule. Reused below
  // both for the initial mount and for re-triggering on tab (re)selection —
  // custom tab presses fire "tabPress" whether or not this tab was already
  // focused, so the listener below covers both "switch back to Schedule" and
  // "tap Schedule again while already on it".
  // `animated` is false on mount — the list should simply *open* on the active
  // card, and animating from a position the user never saw just looks like a
  // glitch — but true on a tab press, where the user is already looking at the
  // list and needs to follow where it travels to.
  const scrollToActive = useCallback(
    (animated = false) => {
      const sectionIndex = sections.findIndex((section) => section.key === todayKey);
      if (sectionIndex === -1) return;
      const rows = sections[sectionIndex].data;
      let rowIndex = rows.findIndex((row) => row.kind === "item" && row.active);
      if (rowIndex === -1) rowIndex = rows.findIndex((row) => row.kind === "now");
      if (rowIndex === -1) return;
      scrollAnimated.current = animated;
      requestAnimationFrame(() => {
        listRef.current?.scrollToLocation({
          sectionIndex,
          // scrollToLocation counts the (sticky) section header as itemIndex 0,
          // so the row at data index N lives at itemIndex N + 1. Passing the raw
          // data index lands one card above the active one.
          itemIndex: rowIndex + 1,
          viewOffset: 80,
          animated,
        });
      });
    },
    [sections, todayKey],
  );

  // scrollToLocation is a silent no-op whenever the target sits past the list's
  // highest *measured* row: these cards are variable-height so there's no
  // getItemLayout, and VirtualizedList only measures what it has rendered —
  // initially just initialNumToRender rows at offset 0. Retrying alone never
  // fixes that, because a list that never moves never measures anything new.
  // So jump to the estimated offset first (that drags the render window over
  // the target and gets it measured) and only then re-issue the exact scroll.
  // The counter is reset wherever a *fresh* scroll is kicked off (mount, tab
  // press) so each of those gets its own budget.
  function retryScrollToActive(info: { averageItemLength: number; index: number }) {
    if (scrollRetries.current >= 5) return;
    scrollRetries.current += 1;
    // The estimated jump is a measurement trick, never animated: it lands on a
    // guess, and the exact scroll right after would fight the animation.
    listRef.current
      ?.getScrollResponder()
      ?.scrollTo({ y: Math.max(0, info.averageItemLength * info.index - 80), animated: false });
    if (scrollRetryTimer.current) clearTimeout(scrollRetryTimer.current);
    scrollRetryTimer.current = setTimeout(() => scrollToActive(scrollAnimated.current), 120);
  }

  useEffect(
    () => () => {
      if (scrollRetryTimer.current) clearTimeout(scrollRetryTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (scrolledOnLoad.current || loading || sections.length === 0) return;
    scrolledOnLoad.current = true;
    scrollRetries.current = 0;
    scrollToActive();
  }, [sections, scrollToActive, loading]);

  // Mirrors expo-router's own bundled `useScrollToTop`. The tab navigator emits
  // "tabPress" from the parent tab navigation, so the listener belongs there
  // rather than on this screen's nested Stack navigation.
  //
  // The event is emitted *before* the tab switch is dispatched, which is what
  // makes the isFocused() check below mean "Schedule was already the open tab":
  // coming back from another tab leaves the list where you left it, and only a
  // second press on an already-open Schedule scrolls back to the active card.
  useEffect(() => {
    // "tabPress" isn't part of the generic event map expo-router's
    // `useNavigation()` exposes, hence the narrow cast rather than `any`.
    const tabAware = (tabNavigation ?? navigation) as unknown as {
      addListener: (type: "tabPress", callback: () => void) => () => void;
    };
    return tabAware.addListener("tabPress", () => {
      if (!navigation.isFocused()) return;
      scrollRetries.current = 0;
      scrollToActive(true);
    });
  }, [navigation, scrollToActive, tabNavigation]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function toggleKind(kind: string) {
    void haptic("selection");
    setSelectedKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );
  }

  function toggleAudience(audience: AudienceFilterValue) {
    void haptic("selection");
    setSelectedAudiences((current) =>
      current.includes(audience) ? current.filter((a) => a !== audience) : [...current, audience],
    );
  }

  async function deleteEntry(item: ScheduleItem) {
    try {
      await deleteScheduleItem(item.id);
      await load();
    } catch {
      Alert.alert(t("scheduleDeleteError"));
    }
  }

  function confirmDelete(item: ScheduleItem) {
    Alert.alert(t("scheduleDeleteConfirmTitle"), t("scheduleDeleteConfirmMessage"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("scheduleDelete"),
        style: "destructive",
        onPress: () => void deleteEntry(item),
      },
    ]);
  }

  async function submitForm(
    values: ScheduleInput,
    pendingOwners: ({ userId: number } | { freeTextName: string })[],
  ): Promise<AdminScheduleItem> {
    let result: AdminScheduleItem;
    if (formTarget === "create") {
      const created = await createScheduleItem(values);
      for (const input of pendingOwners) await addScheduleOwner(created.id, input);
      result = created;
    } else if (formTarget) {
      result = await updateScheduleItem(formTarget.id, values);
    } else {
      throw new Error("No schedule form target");
    }
    return result;
  }

  function finishFormSave(updated: AdminScheduleItem) {
    setData((current) => upsertScheduleItem(current, updated));
    setFormTarget(null);
  }

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {glassAvailable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="bell.badge"
            accessibilityLabel={t("scheduleNotificationsTitle")}
            onPress={() => setSettingsOpen(true)}
          />
          <Stack.Toolbar.Button
            icon={
              filterActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease"
            }
            accessibilityLabel={t("scheduleFilter")}
            selected={filterOpen}
            tintColor={filterActive ? colors.accent : undefined}
            onPress={() => setFilterOpen((current) => !current)}
          />
        </Stack.Toolbar>
      ) : (
        <LegacyScheduleHeader
          topInset={legacyTopInset}
          title={t("tabSchedule")}
          searchOpen={legacySearchOpen}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onOpenSearch={() => setLegacySearchOpen(true)}
          onCloseSearch={() => {
            setLegacySearchOpen(false);
            setSearchQuery("");
          }}
          notificationsLabel={t("scheduleNotificationsTitle")}
          onNotificationsPress={() => setSettingsOpen(true)}
          filterLabel={t("scheduleFilter")}
          filterOpen={filterOpen}
          filterActive={filterActive}
          onToggleFilter={() => setFilterOpen((current) => !current)}
          searchLabel={t("scheduleSearch")}
          searchPlaceholder={t("scheduleSearchPlaceholder")}
          cancelLabel={t("cancel")}
        />
      )}
      {canManage ? (
        <GlassView
          colorScheme="auto"
          glassEffectStyle="regular"
          isInteractive
          style={{
            borderRadius: 26,
            bottom: tabBarBottomInset + FAB_BOTTOM_OFFSET,
            height: FAB_SIZE,
            position: "absolute",
            right: FAB_MARGIN,
            width: FAB_SIZE,
            zIndex: 10,
          }}
        >
          <Pressable
            accessibilityLabel={t("scheduleAdd")}
            accessibilityRole="button"
            onPress={() => setFormTarget("create")}
            style={{ alignItems: "center", flex: 1, justifyContent: "center" }}
          >
            <SymbolView name="plus" tintColor={colors.label} size={20} weight="semibold" />
          </Pressable>
        </GlassView>
      ) : null}
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(row) => (row.kind === "now" ? row.id : String(row.id))}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          // Exactly clears the FAB (its own offset + height + a small gap) —
          // was previously adding `insets.bottom` a second time on top of an
          // already-inset-aware FAB offset, which let the list scroll well
          // past the last card into empty space.
          paddingBottom: canManage
            ? tabBarScrollBottomInset + FAB_BOTTOM_OFFSET + FAB_SIZE + 16
            : tabBarScrollBottomInset + 16,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        stickySectionHeadersEnabled
        onScrollToIndexFailed={(info) => retryScrollToActive(info)}
        ListHeaderComponent={
          <View style={{ gap: 8 }}>
            <StaleDataBanner
              updatedAt={staleSince}
              onRetry={() => void load()}
              retrying={loading}
            />
            {notifications.error ? (
              <RequestFeedback
                error={notifications.error}
                message={t("scheduleReminderError")}
                onRetry={notifications.retry}
                retrying={notifications.savingKey !== null}
              />
            ) : null}
          </View>
        }
        ListHeaderComponentStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
        ListEmptyComponent={
          loading ? (
            <RequestFeedback loading />
          ) : error ? (
            <RequestFeedback error={error} onRetry={() => void load()} />
          ) : (
            <EmptyState
              icon="calendar.badge.clock"
              title={t("scheduleEmptyTitle")}
              description={normalizedQuery ? t("scheduleSearchEmpty") : t("scheduleEmpty")}
            />
          )
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              backgroundColor: colors.background,
              height: SECTION_HEADER_HEIGHT,
              justifyContent: "center",
            }}
          >
            <Text
              selectable
              accessibilityRole="header"
              style={{
                color: colors.secondaryLabel,
                fontSize: 13,
                fontWeight: "600",
                paddingHorizontal: 16,
                textTransform: "uppercase",
              }}
            >
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) =>
          item.kind === "now" ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ width: 70, alignItems: "center" }}>
                  <Text
                    style={{
                      color: colors.accent,
                      fontSize: 13,
                      fontVariant: ["tabular-nums"],
                      fontWeight: "700",
                    }}
                  >
                    {formatTime(now, language)}
                  </Text>
                </View>
                <View
                  style={{ backgroundColor: colors.accent, flex: 1, height: 2, marginLeft: 8 }}
                />
              </View>
            </View>
          ) : (
            <ScheduleSwipeRow
              enabled={canManage}
              editLabel={t("scheduleEdit")}
              deleteLabel={t("scheduleDelete")}
              onEdit={() => setFormTarget(item)}
              onDelete={() => confirmDelete(item)}
            >
              <ScheduleCard
                item={item}
                active={item.active}
                language={language}
                last={index === section.data.length - 1}
                reminderOn={notifications.ready ? notifications.isEntrySubscribed(item) : null}
                reminderBusy={notifications.savingKey === itemCategory(item.id)}
                onToggleReminder={() => void notifications.toggleEntry(item)}
              />
            </ScheduleSwipeRow>
          )
        }
      />

      {formTarget === "create" ? (
        <ScheduleFormModal
          visible
          onClose={() => setFormTarget(null)}
          onSaved={finishFormSave}
          onSubmit={submitForm}
        />
      ) : formTarget ? (
        <AdminScheduleFormLoader
          target={formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={finishFormSave}
          onSubmit={submitForm}
        />
      ) : null}

      <ScheduleNotificationsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        kinds={kinds}
        items={items}
        categoryState={notifications.categoryState}
        onToggleCategory={(kind, enabled) => void notifications.toggleCategory(kind, enabled)}
        isEntrySubscribed={(item) =>
          notifications.ready ? notifications.isEntrySubscribed(item) : false
        }
        onToggleEntry={(item) => void notifications.toggleEntry(item)}
        savingKey={notifications.savingKey}
      />

      <ScheduleFilterPanel
        open={filterOpen}
        anchor={filterAnchor}
        onClose={() => setFilterOpen(false)}
        kinds={kinds}
        selectedKinds={selectedKinds}
        onToggleKind={toggleKind}
        showAudience={canManage}
        selectedAudiences={selectedAudiences}
        onToggleAudience={toggleAudience}
        onClear={() => {
          setSelectedKinds([]);
          setSelectedAudiences([]);
        }}
      />
    </View>
  );
}

/**
 * The public feed doesn't carry admin-only fields (visibility, publishAt,
 * contactNote, notes, owners), so editing an existing item loads the full
 * admin record once the form opens instead of prefilling with placeholders.
 */
function AdminScheduleFormLoader({
  target,
  onClose,
  onSubmit,
  onSaved,
}: {
  target: "create" | ScheduleItem | null;
  onClose: () => void;
  onSubmit: (
    values: ScheduleInput,
    pendingOwners: ({ userId: number } | { freeTextName: string })[],
  ) => Promise<AdminScheduleItem>;
  onSaved: (item: AdminScheduleItem) => void | Promise<void>;
}) {
  const { language } = useLocale();
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof fetchAdminSchedule>> | null>(null);

  useEffect(() => {
    if (!target || target === "create") {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    void fetchAdminSchedule().then((items) => {
      if (!cancelled) setLoaded(items);
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target || target === "create") return null;
  const adminItem = loaded?.find((candidate) => candidate.id === target.id);
  if (!adminItem) return null;

  return (
    <ScheduleFormModal
      visible
      onClose={onClose}
      initial={scheduleItemToForm(adminItem, language)}
      initialTranslations={scheduleItemToTranslations(adminItem, language)}
      scheduleId={adminItem.id}
      initialOwners={adminItem.owners}
      onSaved={onSaved}
      onSubmit={onSubmit}
    />
  );
}

/**
 * Header for platforms without real Liquid Glass (Android, iOS <26): the
 * original hand-rolled title + bell/filter pill + search button, rendered
 * inline in the screen body with the native header hidden. `GlassView`
 * already renders these as opaque round buttons on its own on these
 * platforms — this is only about the *layout* a native header can't
 * express (a shared multi-touch-zone pill, an in-place expanding search
 * field), not about re-implementing glass styling.
 */
function LegacyScheduleHeader({
  topInset,
  title,
  searchOpen,
  searchQuery,
  onSearchQueryChange,
  onOpenSearch,
  onCloseSearch,
  notificationsLabel,
  onNotificationsPress,
  filterLabel,
  filterOpen,
  filterActive,
  onToggleFilter,
  searchLabel,
  searchPlaceholder,
  cancelLabel,
}: {
  topInset: number;
  title: string;
  searchOpen: boolean;
  searchQuery: string;
  onSearchQueryChange: (text: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  notificationsLabel: string;
  onNotificationsPress: () => void;
  filterLabel: string;
  filterOpen: boolean;
  filterActive: boolean;
  onToggleFilter: () => void;
  searchLabel: string;
  searchPlaceholder: string;
  cancelLabel: string;
}) {
  return (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingTop: topInset, zIndex: 10 }}>
      {searchOpen ? (
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 8,
            paddingTop: 8,
            paddingBottom: 4,
          }}
        >
          <GlassView
            colorScheme="auto"
            glassEffectStyle="regular"
            style={{ borderRadius: 12, flex: 1, height: 40, overflow: "hidden" }}
          >
            <View
              style={{
                alignItems: "center",
                flex: 1,
                flexDirection: "row",
                gap: 6,
                paddingHorizontal: 12,
              }}
            >
              <SymbolView name="magnifyingglass" tintColor={colors.tertiaryLabel} size={16} />
              <TextInput
                autoFocus
                accessibilityLabel={searchLabel}
                onChangeText={onSearchQueryChange}
                placeholder={searchPlaceholder}
                placeholderTextColor={colors.tertiaryLabel}
                returnKeyType="search"
                style={{ color: colors.label, flex: 1, fontSize: 16 }}
                value={searchQuery}
              />
            </View>
          </GlassView>
          <Pressable
            accessibilityLabel={cancelLabel}
            accessibilityRole="button"
            onPress={onCloseSearch}
          >
            <Text style={{ color: colors.accent, fontSize: 16, fontWeight: "600" }}>
              {cancelLabel}
            </Text>
          </Pressable>
        </View>
      ) : (
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "space-between",
            paddingTop: 8,
            paddingBottom: 4,
          }}
        >
          <Text style={{ color: colors.label, fontSize: 28, fontWeight: "800" }}>{title}</Text>
          <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
            <GlassView
              colorScheme="auto"
              glassEffectStyle="regular"
              isInteractive
              style={{ alignItems: "center", borderRadius: 22, flexDirection: "row", height: 44 }}
            >
              <LegacyHeaderIconButton
                icon="bell.badge"
                accessibilityLabel={notificationsLabel}
                onPress={onNotificationsPress}
              />
              <View
                style={{ backgroundColor: colors.separator, height: 20, opacity: 0.6, width: 1 }}
              />
              <LegacyHeaderIconButton
                icon={
                  filterActive
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease"
                }
                accessibilityLabel={filterLabel}
                tintColor={filterActive ? colors.accent : colors.label}
                accessibilityState={{ expanded: filterOpen, selected: filterActive }}
                onPress={onToggleFilter}
              />
            </GlassView>
            <GlassView
              colorScheme="auto"
              glassEffectStyle="regular"
              isInteractive
              style={{ borderRadius: 22, height: 44, width: 44 }}
            >
              <LegacyHeaderIconButton
                icon="magnifyingglass"
                accessibilityLabel={searchLabel}
                onPress={onOpenSearch}
              />
            </GlassView>
          </View>
        </View>
      )}
    </View>
  );
}

function LegacyHeaderIconButton({
  icon,
  accessibilityLabel,
  accessibilityState,
  tintColor,
  onPress,
}: {
  icon:
    | "bell.badge"
    | "line.3.horizontal.decrease.circle.fill"
    | "line.3.horizontal.decrease"
    | "magnifyingglass";
  accessibilityLabel: string;
  accessibilityState?: { expanded?: boolean; selected?: boolean };
  tintColor?: ColorValue;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={() => {
        void haptic("light");
        onPress();
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 44,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
        width: 44,
      })}
    >
      <SymbolView name={icon} tintColor={tintColor ?? colors.label} size={19} weight="semibold" />
    </Pressable>
  );
}

function safeTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function formatTime(timestamp: number, locale: string) {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Space between a time label and the line that follows it — kept tight so
// the line reads as anchored to the label it belongs to.
const TIMELINE_GAP_AFTER_LABEL = 6;
// Space between a line and the time label that follows it — wider, so the
// upcoming time gets a beat of anticipation before it appears.
const TIMELINE_GAP_BEFORE_LABEL = 8;
// Fixed-length connector between one activity's end and the next one's start.
const TIMELINE_GAP_LINE_LENGTH = 12;

const COLLAPSED_TITLE_LINES = 2;
const COLLAPSED_DESCRIPTION_LINES = 2;

/**
 * Whether a card's text needs the collapsed-with-fade treatment. `numberOfLines`
 * clamps without telling us it did, and `onTextLayout` needs a real layout
 * pass, so we go by length: short entries render in full, long ones clamp
 * with a fade hint that there's more to read in the detail view (H374).
 */
export function isScheduleCardTruncated(item: Pick<ScheduleItem, "title" | "description">) {
  const description = item.description ?? "";
  return description.includes("\n") || description.length > 90 || item.title.length > 60;
}

const START_TIME_FLAG_RADIUS = 5;
const START_TIME_FLAG_PADDING_H = 6;
const START_TIME_FLAG_PADDING_V = 3;
const _START_TIME_FLAG_GAP = 6;

/** The badge marking the currently-active item's start time. */
function StartTimeFlag({ time }: { time: string }) {
  return (
    <View
      style={{
        backgroundColor: colors.accent,
        borderRadius: START_TIME_FLAG_RADIUS,
        paddingHorizontal: START_TIME_FLAG_PADDING_H,
        paddingVertical: START_TIME_FLAG_PADDING_V,
      }}
    >
      <Text
        style={{
          color: colors.accentText,
          fontSize: 13,
          fontVariant: ["tabular-nums"],
          fontWeight: "700",
          lineHeight: 16,
        }}
      >
        {time}
      </Text>
    </View>
  );
}

function ScheduleCard({
  item,
  active,
  language,
  last,
  reminderOn,
  reminderBusy,
  onToggleReminder,
}: {
  item: ScheduleItem;
  active: boolean;
  language: string;
  last: boolean;
  reminderOn: boolean | null;
  reminderBusy: boolean;
  onToggleReminder: () => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const truncated = isScheduleCardTruncated(item);
  const startsAt = new Date(item.startsAt);
  const endsAt = new Date(item.endsAt);
  const time = startsAt.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = endsAt.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });

  function toggleReminder(event: GestureResponderEvent) {
    event.stopPropagation();
    onToggleReminder();
  }

  return (
    <View style={{ backgroundColor: colors.background, paddingHorizontal: 16 }}>
      <View style={{ flexDirection: "row" }}>
        {/* Purely visual — the card's accessibilityLabel below already announces
            the start and end times, so this column would otherwise double up. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ alignItems: "center", width: 70 }}
        >
          {active ? (
            <View style={{ marginTop: TIMELINE_GAP_BEFORE_LABEL }}>
              <StartTimeFlag time={time} />
            </View>
          ) : (
            <Text
              style={{
                color: colors.label,
                fontSize: 15,
                fontVariant: ["tabular-nums"],
                fontWeight: "600",
                marginTop: TIMELINE_GAP_BEFORE_LABEL,
              }}
            >
              {time}
            </Text>
          )}
          {/* Duration: start to end. */}
          <View
            style={{
              backgroundColor: colors.separator,
              flex: 1,
              marginTop: TIMELINE_GAP_AFTER_LABEL,
              width: 1,
            }}
          />
          <Text
            style={{
              color: colors.tertiaryLabel,
              fontSize: 13,
              fontVariant: ["tabular-nums"],
              fontWeight: "500",
              marginBottom: TIMELINE_GAP_AFTER_LABEL,
              marginTop: TIMELINE_GAP_BEFORE_LABEL,
            }}
          >
            {end}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={[
            item.title,
            time,
            end,
            item.location,
            reminderOn === null
              ? null
              : t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
                  name: item.title,
                }),
          ]
            .filter(Boolean)
            .join(", ")}
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/schedule/[id]",
              params: { id: String(item.id) },
            })
          }
          style={{
            backgroundColor: colors.surface,
            borderCurve: "continuous",
            borderRadius: 14,
            flex: 1,
            marginLeft: 8,
            position: "relative",
          }}
        >
          {reminderOn !== null ? (
            <Pressable
              accessibilityLabel={t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
                name: item.title,
              })}
              accessibilityRole="button"
              accessibilityState={{ selected: reminderOn, busy: reminderBusy }}
              disabled={reminderBusy}
              onPress={toggleReminder}
              hitSlop={{ bottom: 14, left: 14, right: 14, top: 14 }}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                height: 22,
                position: "absolute",
                right: 12,
                top: 12,
                width: 22,
                opacity: reminderBusy ? 0.4 : pressed ? 0.65 : 1,
              })}
            >
              <SymbolView
                name={reminderOn ? "bell.fill" : "bell"}
                tintColor={reminderOn ? colors.accent : colors.tertiaryLabel}
                size={19}
              />
            </Pressable>
          ) : null}
          <View style={{ gap: 11, padding: 18, paddingRight: 40 }}>
            <View style={{ alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Text
                selectable
                numberOfLines={truncated ? COLLAPSED_TITLE_LINES : undefined}
                style={{ color: colors.label, flexShrink: 1, fontSize: 17, fontWeight: "700" }}
              >
                {item.title}
              </Text>
              {item.audiences.length === 0 ? (
                <StatusPill tone="neutral" style={{ alignSelf: "center" }}>
                  {t("scheduleStaffOnlyBadge")}
                </StatusPill>
              ) : item.visibility === "hidden" ? (
                <StatusPill tone="warning" style={{ alignSelf: "center" }}>
                  {t("scheduleDraftBadge")}
                </StatusPill>
              ) : null}
            </View>
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {item.type ? (
                <Text
                  style={{
                    alignSelf: "center",
                    color: colors.secondaryLabel,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {scheduleTypeLabel(item.type, t)}
                </Text>
              ) : null}
              {item.type && item.location ? (
                <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>·</Text>
              ) : null}
              {item.location ? (
                <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                  {item.location}
                </Text>
              ) : null}
            </View>
            {item.description ? (
              <Text
                selectable
                numberOfLines={truncated ? COLLAPSED_DESCRIPTION_LINES : undefined}
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 15,
                  lineHeight: 21,
                }}
              >
                {item.description}
              </Text>
            ) : null}
          </View>
          {/* Where "show more" used to sit — the whole card now always opens
              the detail view instead of expanding in place. */}
          <SymbolView
            accessible={false}
            name="chevron.right"
            tintColor={colors.tertiaryLabel}
            size={13}
            style={{ bottom: 14, position: "absolute", right: 14 }}
          />
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", height: TIMELINE_GAP_LINE_LENGTH }}>
        {/* Gap: this activity's end to the next one's start — same tone as
            the line inside the card above. */}
        {!last ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ alignItems: "center", width: 70 }}
          >
            <View style={{ backgroundColor: colors.separator, flex: 1, width: 1 }} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
