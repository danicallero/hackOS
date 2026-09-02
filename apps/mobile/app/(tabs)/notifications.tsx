import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { useScrollToTop } from "expo-router";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  useColorScheme,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { ManageAnnouncementsView } from "@/components/announcement-manage-view";
import { GlassView } from "@/components/glass-view";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SegmentedControl } from "@/components/segmented-control";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  emitNotificationChange,
  subscribeToCategory,
  subscribeToNotificationChanges,
} from "@/lib/notification-events";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { subscribeToServerEvent } from "@/lib/server-events";
import { has } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Channel = "in_app" | "email" | "push";
const VALID_CHANNELS: Channel[] = ["in_app", "email", "push"];

/** Drops any stale channel a device cached before a channel was retired (e.g. the old Discord channel). */
function validChannels(channels: Channel[]): Channel[] {
  return channels.filter((channel) => (VALID_CHANNELS as string[]).includes(channel));
}

interface Preferences {
  channels: Channel[];
  mandatoryCategories: string[];
  overrides: { category: string; channel: Channel; enabled: boolean }[];
}

/** Mirrors the server's ON CONFLICT upsert, for an instant optimistic local view. */
function withOverride(prefs: Preferences, category: string, channel: Channel, enabled: boolean) {
  const overrides = [...prefs.overrides];
  const index = overrides.findIndex((row) => row.category === category && row.channel === channel);
  if (index === -1) overrides.push({ category, channel, enabled });
  else overrides[index] = { category, channel, enabled };
  return { ...prefs, overrides };
}

interface InboxItem {
  id: number;
  category: string;
  payload: unknown;
  status: string;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

interface InboxResponse {
  items: InboxItem[];
  total: number;
}

const LIMIT = 20;

const LOAD_MORE_THRESHOLD = 130;
const LOAD_MORE_BANDS = 12;
const LOAD_MORE_END_DISTANCE = 24;

/** The segmented control plus an optional trailing action, memoized so toggling the bell doesn't also re-render whichever hidden tab it's shared with. */
const NotificationsHeader = memo(function NotificationsHeader({
  values,
  selectedIndex,
  onChangeIndex,
  trailing,
  t,
}: {
  values: string[];
  selectedIndex: number;
  onChangeIndex: (index: number) => void;
  trailing?: ReactNode;
  t: ReturnType<typeof useLocale>["t"];
}) {
  return (
    <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <SegmentedControl
          label={t("tabNotifications")}
          values={values}
          selectedIndex={selectedIndex}
          onChange={onChangeIndex}
        />
      </View>
      {trailing ?? <View style={{ width: 36 }} />}
    </View>
  );
});

function UnreadBellButton({
  active,
  checked,
  onToggle,
  t,
}: {
  active: boolean;
  checked: boolean;
  onToggle: () => void;
  t: ReturnType<typeof useLocale>["t"];
}) {
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive={active}
      tintColor={active && checked ? (colors.accent as string) : undefined}
      style={{ borderRadius: 18, height: 36, opacity: active ? 1 : 0.4, width: 36 }}
    >
      <Pressable
        accessibilityLabel={t("notificationsUnreadOnly")}
        accessibilityRole="switch"
        accessibilityState={{ checked, disabled: !active }}
        disabled={!active}
        hitSlop={6}
        onPress={onToggle}
        style={({ pressed }) => ({
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <SymbolView
          name="bell.badge.fill"
          tintColor={active && checked ? "white" : colors.secondaryLabel}
          size={17}
          accessible={false}
        />
      </Pressable>
    </GlassView>
  );
}

function AddAnnouncementButton({
  onPress,
  t,
}: {
  onPress: () => void;
  t: ReturnType<typeof useLocale>["t"];
}) {
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive
      style={{ borderRadius: 18, height: 36, width: 36 }}
    >
      <Pressable
        accessibilityLabel={t("announcementAdd")}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => {
          void haptic("light");
          onPress();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <SymbolView
          name="plus"
          tintColor={colors.label}
          size={17}
          weight="semibold"
          accessible={false}
        />
      </Pressable>
    </GlassView>
  );
}

/** Full in-app inbox, notification preferences, and (ANNOUNCEMENTS_MANAGE only) announcement management, matching the web participant/admin views. */
export default function NotificationsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const { me } = useMeContext();
  const canManageAnnouncements = has(me?.capabilities ?? [], CAPABILITIES.ANNOUNCEMENTS_MANAGE);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState<"create" | number | null>(null);
  const androidTopInset = useAndroidTopInset();
  const onMessages = selectedIndex === 0;
  const onManage = canManageAnnouncements && selectedIndex === 2;

  const headerValues = canManageAnnouncements
    ? [t("notificationsMessages"), t("notificationsPreferences"), t("notificationsManage")]
    : [t("notificationsMessages"), t("notificationsPreferences")];

  const toggleUnread = useCallback(() => {
    void haptic("selection");
    setUnreadOnly((current) => !current);
  }, []);

  // A separate header element per tab (not one shared node) so a change that
  // only matters on one tab — the unread bell on Messages, the Add button on
  // Manage — doesn't also re-render the other hidden trees it would
  // otherwise be passed into: each copy's props are stable unless its own
  // tab's state actually changed, so the memoized header bails out and the
  // other tabs stay fully idle.
  const messagesHeader = useMemo(
    () => (
      <NotificationsHeader
        values={headerValues}
        selectedIndex={selectedIndex}
        onChangeIndex={setSelectedIndex}
        trailing={
          <UnreadBellButton
            active={onMessages}
            checked={unreadOnly}
            onToggle={toggleUnread}
            t={t}
          />
        }
        t={t}
      />
    ),
    [headerValues, selectedIndex, onMessages, unreadOnly, toggleUnread, t],
  );
  const preferencesHeader = useMemo(
    () => (
      <NotificationsHeader
        values={headerValues}
        selectedIndex={selectedIndex}
        onChangeIndex={setSelectedIndex}
        t={t}
      />
    ),
    [headerValues, selectedIndex, t],
  );
  const manageHeader = useMemo(
    () => (
      <NotificationsHeader
        values={headerValues}
        selectedIndex={selectedIndex}
        onChangeIndex={setSelectedIndex}
        trailing={<AddAnnouncementButton onPress={() => setAnnouncementForm("create")} t={t} />}
        t={t}
      />
    ),
    [headerValues, selectedIndex, t],
  );

  // All tabs stay mounted (toggled with `display`, not conditional
  // rendering) so switching back to one that already loaded its data shows
  // it instantly instead of remounting into a fresh loading state.
  return (
    <>
      <View style={{ display: onMessages ? "flex" : "none", flex: 1 }}>
        <MessagesView
          tabSwitcher={messagesHeader}
          androidTopInset={androidTopInset}
          unreadOnly={unreadOnly}
        />
      </View>
      <View style={{ display: !onMessages && !onManage ? "flex" : "none", flex: 1 }}>
        <PreferencesView tabSwitcher={preferencesHeader} androidTopInset={androidTopInset} />
      </View>
      {canManageAnnouncements ? (
        <View style={{ display: onManage ? "flex" : "none", flex: 1 }}>
          <ManageAnnouncementsView
            tabSwitcher={manageHeader}
            androidTopInset={androidTopInset}
            formOpen={announcementForm}
            onFormOpenChange={setAnnouncementForm}
          />
        </View>
      ) : null}
    </>
  );
}

const MessagesView = memo(function MessagesView({
  tabSwitcher,
  androidTopInset,
  unreadOnly,
}: {
  tabSwitcher: ReactNode;
  androidTopInset: number;
  unreadOnly: boolean;
}) {
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [actionError, setActionError] = useState<Error | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [readingId, setReadingId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const actionRetry = useRef<(() => Promise<void>) | null>(null);
  const loadingMoreRef = useRef(false);
  const loadMoreRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const pullProgress = useSharedValue(0);
  const pullArmed = useSharedValue(false);
  const pullBand = useSharedValue(0);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);

  useScrollToTop(scrollRef);

  // Two independent caches, both kept warm at once — "unread only" needs to
  // show every unread message (the server's real unread total), not just
  // whatever happens to be on the currently-loaded "all" page, so it can't
  // be a client-side filter. Loading both up front means flipping the bell
  // swaps between two already-fetched datasets instead of triggering a
  // fresh request and a loading flash.
  const fetchAll = useCallback(
    () => apiFetch<InboxResponse>(`/api/me/notifications?limit=${LIMIT}&offset=0`),
    [],
  );
  const fetchUnread = useCallback(
    () => apiFetch<InboxResponse>(`/api/me/notifications?limit=${LIMIT}&offset=0&unread=true`),
    [],
  );
  const all = useCachedApi(`user:${me?.id ?? "unknown"}:notifications:all`, fetchAll);
  const unread = useCachedApi(`user:${me?.id ?? "unknown"}:notifications:unread`, fetchUnread);
  const { data, loading, error, staleSince, load, setData } = unreadOnly ? unread : all;

  useEffect(() => {
    void all.load();
    void unread.load();
  }, [all.load, unread.load]);

  useEffect(() => {
    const reload = () => {
      void all.load();
      void unread.load();
    };
    return subscribeToCategory("announcements", reload);
  }, [all.load, unread.load]);
  useEffect(() => {
    const reload = () => {
      void all.load();
      void unread.load();
    };
    return subscribeToServerEvent(EVENTS.USER_NOTIFICATION, reload);
  }, [all.load, unread.load]);

  /** Applies an update to whichever of the two caches currently holds `itemId`, keeping both in sync. */
  function updateBothCaches(itemId: number, update: (row: InboxItem) => InboxItem) {
    for (const cache of [all, unread]) {
      cache.setData((current) =>
        current?.items.some((row) => row.id === itemId)
          ? {
              ...current,
              items: current.items.map((row) => (row.id === itemId ? update(row) : row)),
            }
          : current,
      );
    }
  }

  /** Removes `itemId` from both caches (delete, or a read item dropping out of "unread only"). */
  function removeFromBothCaches(itemId: number) {
    for (const cache of [all, unread]) {
      cache.setData((current) =>
        current?.items.some((row) => row.id === itemId)
          ? {
              total: Math.max(0, current.total - 1),
              items: current.items.filter((row) => row.id !== itemId),
            }
          : current,
      );
    }
  }

  async function markRead(item: InboxItem) {
    if (item.read_at) return;
    actionRetry.current = () => markRead(item);
    setReadingId(item.id);
    setActionError(null);
    try {
      const result = await apiFetch<{ id: number; read_at: string }>(
        `/api/me/notifications/${item.id}/read`,
        {
          method: "POST",
        },
      );
      // Stays in the "unread only" list — just no longer styled as unread —
      // until the user collapses it again (H489): removing it immediately
      // would filter out the very item they just opened to read.
      updateBothCaches(item.id, (row) => ({ ...row, read_at: result.read_at }));
      emitNotificationChange();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause : new Error("Failed to mark notification read"),
      );
    } finally {
      setReadingId(null);
    }
  }

  function toggleExpanded(item: InboxItem) {
    const wasExpanded = expanded.has(item.id);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (!item.read_at) {
      void markRead(item);
    } else if (wasExpanded && unreadOnly) {
      // Collapsing an already-read item while filtering unread-only: its
      // grace period is over, so it can now drop out of the list (H489).
      unread.setData((current) =>
        current
          ? {
              total: Math.max(0, current.total - 1),
              items: current.items.filter((row) => row.id !== item.id),
            }
          : current,
      );
    }
  }

  function confirmDelete(item: InboxItem) {
    Alert.alert(t("notificationsDeleteTitle"), t("notificationsDeleteBody"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () => void deleteNotification(item),
      },
    ]);
  }

  async function deleteNotification(item: InboxItem) {
    actionRetry.current = () => deleteNotification(item);
    setDeletingId(item.id);
    setActionError(null);
    try {
      await apiFetch<{ id: number }>(`/api/me/notifications/${item.id}`, {
        method: "DELETE",
      });
      removeFromBothCaches(item.id);
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      emitNotificationChange();
      void haptic("warning");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error(t("notificationsCouldNotDelete")));
    } finally {
      setDeletingId(null);
    }
  }

  async function loadMore() {
    // Android can report both the end of a drag and the end of its momentum
    // for one gesture. Keep the guard synchronous so those callbacks cannot
    // start the same page twice before React has rendered `loadingMore`.
    if (!data || loadingMoreRef.current || data.items.length >= data.total) return;
    loadingMoreRef.current = true;
    actionRetry.current = () => loadMore();
    setLoadingMore(true);
    setActionError(null);
    try {
      const query = unreadOnly ? "&unread=true" : "";
      const nextPage = await apiFetch<InboxResponse>(
        `/api/me/notifications?limit=${LIMIT}&offset=${data.items.length}${query}`,
      );
      setData((current) => {
        if (!current) return nextPage;
        const existingIds = new Set(current.items.map((item) => item.id));
        return {
          total: nextPage.total,
          items: [...current.items, ...nextPage.items.filter((item) => !existingIds.has(item.id))],
        };
      });
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause : new Error(t("notificationsCouldNotLoadMore")),
      );
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await Promise.all([all.load(), unread.load()]);
    } finally {
      setRefreshing(false);
    }
  }

  const items = data?.items ?? [];
  const canLoadMore = Boolean(data) && items.length < (data?.total ?? 0) && !loadingMore;
  const canLoadMoreSV = useSharedValue(canLoadMore);
  useEffect(() => {
    canLoadMoreSV.value = canLoadMore;
  }, [canLoadMore, canLoadMoreSV]);

  loadMoreRef.current = loadMore;
  const triggerLoadMore = useCallback(() => {
    void loadMoreRef.current();
  }, []);

  const loadMoreAtAndroidEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (Platform.OS !== "android") return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromEnd = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    // Avoid firing for a short list that is resting at offset 0. The
    // visible button below remains the fallback when the content cannot
    // scroll far enough to produce an end-of-list gesture.
    if (contentOffset.y > 0 && distanceFromEnd <= LOAD_MORE_END_DISTANCE) {
      void loadMoreRef.current();
    }
  }, []);

  const isDragging = useSharedValue(false);

  // Overscrolling past the bottom (iOS's native rubber-band) drives the ring
  // continuously on the UI thread (no per-frame React re-render, so it never
  // steps) and ratchets a light haptic tick every ~1/12th of the way to the
  // threshold, then a stronger one the moment it arms; releasing while armed
  // loads the next page, dragging back below the threshold before releasing
  // cancels silently — same feel as the OS's own pull gestures. Gated on
  // `isDragging`: a short list whose content is shorter than the viewport
  // reports a "positive overscroll" at rest (offset 0, contentSize <
  // layoutMeasurement), which would otherwise show the ring with no finger
  // on the screen.
  const scrollHandler = useAnimatedScrollHandler(
    {
      onBeginDrag: () => {
        isDragging.value = true;
        pullArmed.value = false;
        pullBand.value = 0;
        pullProgress.value = 0;
      },
      onScroll: (event) => {
        if (!isDragging.value || !canLoadMoreSV.value) return;
        const overscroll =
          event.contentOffset.y + event.layoutMeasurement.height - event.contentSize.height;
        const progress = Math.max(0, Math.min(1, overscroll / LOAD_MORE_THRESHOLD));
        pullProgress.value = progress;

        const band = Math.floor(progress * LOAD_MORE_BANDS);
        if (band !== pullBand.value) {
          pullBand.value = band;
          if (band > 0 && band < LOAD_MORE_BANDS) runOnJS(haptic)("selection");
        }

        const armed = overscroll >= LOAD_MORE_THRESHOLD;
        if (armed !== pullArmed.value) {
          pullArmed.value = armed;
          runOnJS(haptic)(armed ? "medium" : "selection");
        }
      },
      onEndDrag: () => {
        isDragging.value = false;
        if (pullArmed.value) runOnJS(triggerLoadMore)();
        pullArmed.value = false;
        pullProgress.value = 0;
      },
    },
    [canLoadMoreSV, triggerLoadMore],
  );

  const retryAction = actionRetry.current;
  const actionRetrying = readingId !== null || deletingId !== null || loadingMore;
  const loadMoreIndicator = (
    <>
      <PullHintText
        progress={pullProgress}
        label={t("notificationsPullToLoadMore")}
        style={{ position: "absolute" }}
      />
      <LoadMoreRing progress={pullProgress} armed={pullArmed} style={{ position: "absolute" }} />
    </>
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 16,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
        paddingTop: 16 + androidTopInset,
      }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      onScroll={Platform.OS === "ios" ? scrollHandler : undefined}
      onScrollEndDrag={Platform.OS === "android" ? loadMoreAtAndroidEnd : undefined}
      onMomentumScrollEnd={Platform.OS === "android" ? loadMoreAtAndroidEnd : undefined}
      scrollEventThrottle={1}
    >
      {tabSwitcher}
      <StaleDataBanner updatedAt={staleSince} />

      {error ? <RequestFeedback error={error} onRetry={() => void load()} /> : null}
      {actionError ? (
        <RequestFeedback
          error={actionError}
          onRetry={retryAction ? () => void retryAction() : undefined}
          retrying={actionRetrying}
        />
      ) : null}
      {loading && !data ? <RequestFeedback loading /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          icon="tray"
          title={unreadOnly ? t("notificationsNoUnread") : t("notificationsEmptyTitle")}
          description={t("notificationsEmptyHint")}
        />
      ) : null}

      {items.length ? (
        <Section>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Separator inset={50} /> : null}
              <NotificationRow
                item={item}
                expanded={expanded.has(item.id)}
                language={language}
                onPress={() => toggleExpanded(item)}
                busy={readingId === item.id}
                deleting={deletingId === item.id}
                onDelete={() => confirmDelete(item)}
              />
            </View>
          ))}
        </Section>
      ) : null}

      {data && data.total > LIMIT ? (
        <View style={{ gap: 18 }}>
          <Text
            selectable
            accessibilityLiveRegion="polite"
            style={{ color: colors.secondaryLabel, fontSize: 13, textAlign: "center" }}
          >
            {t("notificationsShowingLatest", {
              count: String(data.items.length),
              total: String(data.total),
            })}
          </Text>
          {data.items.length < data.total ? (
            Platform.OS === "android" ? (
              <Pressable
                accessibilityLabel={t("notificationsPullToLoadMore")}
                accessibilityRole="button"
                accessibilityState={{ busy: loadingMore, disabled: loadingMore }}
                disabled={loadingMore}
                onPress={() => void loadMoreRef.current()}
                style={({ pressed }) => ({
                  alignItems: "center",
                  height: 44,
                  justifyContent: "center",
                  opacity: loadingMore ? 0.55 : pressed ? 0.65 : 1,
                  position: "relative",
                  width: "100%",
                })}
              >
                {loadMoreIndicator}
              </Pressable>
            ) : (
              <View
                style={{
                  alignItems: "center",
                  height: RING_SIZE,
                  justifyContent: "center",
                  position: "relative",
                  width: "100%",
                }}
              >
                {loadMoreIndicator}
              </View>
            )
          ) : null}
        </View>
      ) : null}
    </Animated.ScrollView>
  );
});

const RING_SIZE = 28;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Gray hint sitting where the ring appears — fades out the moment the ring fades in, never both at once. */
function PullHintText({
  progress,
  label,
  style,
}: {
  progress: SharedValue<number>;
  label: string;
  style?: object;
}) {
  const hintStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, Math.min(1, progress.value * 6)),
  }));
  return (
    <Animated.View style={[style, hintStyle]}>
      <Text selectable={false} style={{ color: colors.tertiaryLabel, fontSize: 12 }}>
        {label}
      </Text>
    </Animated.View>
  );
}

/**
 * Closes continuously as `progress` (a shared value, updated every scroll
 * frame on the UI thread — never through React state) approaches 1. Two
 * rings are stacked (secondary-color, then accent) and cross-faded by
 * opacity for the armed switch — animating an SVG stroke *color* directly
 * crashes RNSVG's Fabric prop conversion, so only numeric props
 * (`strokeDashoffset`, `opacity`) are ever driven through `useAnimatedProps`/
 * `useAnimatedStyle`. The center is never filled with a solid disc — the
 * "release" state is instead a down arrow that the same fill motion reveals
 * in the last stretch, no text involved.
 */
function LoadMoreRing({
  progress,
  armed,
  style,
}: {
  progress: SharedValue<number>;
  armed: SharedValue<boolean>;
  style?: object;
}) {
  const containerStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, Math.min(1, progress.value * 6)),
  }));
  const dashProps = useAnimatedProps(() => ({
    strokeDashoffset: RING_CIRCUMFERENCE * (1 - Math.max(0, Math.min(1, progress.value))),
  }));
  const accentStyle = useAnimatedStyle(() => ({ opacity: armed.value ? 1 : 0 }));
  // The arrow keeps growing out of the same fill motion instead of popping
  // in once armed — it starts appearing in the ring's last quarter-turn.
  const arrowStyle = useAnimatedStyle(() => {
    const reveal = Math.max(0, Math.min(1, (progress.value - 0.75) / 0.25));
    return { opacity: reveal, transform: [{ scale: 0.6 + reveal * 0.4 }] };
  });
  return (
    <Animated.View
      style={[
        { alignItems: "center", height: RING_SIZE, justifyContent: "center", width: RING_SIZE },
        style,
        containerStyle,
      ]}
    >
      <Svg width={RING_SIZE} height={RING_SIZE} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.separator}
          strokeWidth={RING_STROKE}
          fill="none"
        />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={colors.secondaryLabel}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={RING_CIRCUMFERENCE}
          animatedProps={dashProps}
        />
      </Svg>
      <Animated.View
        style={[{ height: RING_SIZE, position: "absolute", width: RING_SIZE }, accentStyle]}
      >
        <Svg width={RING_SIZE} height={RING_SIZE} style={{ transform: [{ rotate: "-90deg" }] }}>
          <AnimatedCircle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={colors.accent}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={RING_CIRCUMFERENCE}
            animatedProps={dashProps}
          />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: "absolute" }, arrowStyle]}>
        <SymbolView name="arrow.down" tintColor={colors.accent} size={12} accessible={false} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The action panel revealed by swiping a notification left, matching the OS
 * notification center's swipe-to-clear gesture: swiping only reveals the
 * button, and the notification is discarded on the deliberate follow-up tap
 * — never by the swipe distance alone, so a stray swipe can't delete data.
 */
function DeleteRevealAction({
  progress,
  onDelete,
}: {
  progress: SharedValue<number>;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  return (
    <Animated.View style={[{ justifyContent: "center", marginLeft: 8 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("notificationsDelete")}
        onPress={onDelete}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.destructive,
          borderCurve: "continuous",
          flexDirection: "row",
          gap: 6,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: 18,
        })}
      >
        <SymbolView name="trash.fill" tintColor="white" size={16} accessible={false} />
        <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>
          {t("notificationsDelete")}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function NotificationRow({
  item,
  expanded,
  language,
  onPress,
  busy,
  deleting,
  onDelete,
}: {
  item: InboxItem;
  expanded: boolean;
  language: string;
  onPress: () => void;
  busy: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const subject = payloadField(item.payload, "subject") ?? categoryLabel(item.category, t);
  const body = payloadField(item.payload, "body");
  const details = payloadDetails(item.payload, t);
  const unread = !item.read_at;
  // The swipe gesture and the row's own tap-to-expand Pressable both listen
  // on the same touch: without this guard, releasing a swipe (even one that
  // snaps back without opening) can also register as a tap and toggle the
  // row's expanded state. Suppress presses for the duration of any drag.
  const swiping = useRef(false);
  const stopSwiping = useCallback(() => {
    setTimeout(() => {
      swiping.current = false;
    }, 50);
  }, []);

  return (
    <Swipeable
      enabled={!deleting && !busy}
      renderRightActions={(progress) => (
        <DeleteRevealAction progress={progress} onDelete={onDelete} />
      )}
      rightThreshold={40}
      onSwipeableOpenStartDrag={() => {
        swiping.current = true;
      }}
      onSwipeableCloseStartDrag={() => {
        swiping.current = true;
      }}
      onSwipeableWillOpen={stopSwiping}
      onSwipeableWillClose={stopSwiping}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: busy || deleting, expanded }}
        onPress={() => {
          if (swiping.current || busy || deleting) return;
          void haptic("light");
          onPress();
        }}
        style={({ pressed }) => ({
          backgroundColor: pressed ? colors.elevatedSurface : colors.surface,
          gap: 9,
          paddingHorizontal: 16,
          paddingVertical: 14,
        })}
      >
        <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
          <View
            accessibilityElementsHidden
            style={{
              backgroundColor: unread ? colors.accent : colors.transparent,
              borderRadius: 4,
              height: 8,
              marginTop: 6,
              width: 8,
            }}
          />
          <View style={{ flex: 1, gap: 5 }}>
            <View style={{ alignItems: "baseline", flexDirection: "row", gap: 8 }}>
              <Text
                selectable
                style={{
                  color: colors.label,
                  flex: 1,
                  fontSize: 16,
                  fontWeight: unread ? "700" : "500",
                }}
              >
                {subject}
              </Text>
              <Text
                selectable
                style={{ color: colors.tertiaryLabel, fontSize: 12, fontVariant: ["tabular-nums"] }}
              >
                {new Date(item.created_at).toLocaleDateString(language, {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </View>
            {body ? (
              <Text
                selectable
                numberOfLines={expanded ? undefined : 2}
                style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 20 }}
              >
                {body}
              </Text>
            ) : null}
            {expanded && details.length ? (
              <View
                style={{
                  backgroundColor: colors.background,
                  borderCurve: "continuous",
                  borderRadius: 10,
                  gap: 7,
                  padding: 10,
                }}
              >
                {details.map((detail) => (
                  <View key={detail.key} style={{ flexDirection: "row", gap: 8 }}>
                    <Text
                      selectable
                      style={{
                        color: colors.secondaryLabel,
                        flexBasis: 90,
                        flexShrink: 1,
                        fontSize: 12,
                      }}
                    >
                      {detail.key}
                    </Text>
                    <Text selectable style={{ color: colors.label, flex: 1, fontSize: 12 }}>
                      {detail.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          <SymbolView
            name={expanded ? "chevron.up" : "chevron.down"}
            tintColor={colors.tertiaryLabel}
            size={14}
            accessible={false}
          />
        </View>
      </Pressable>
    </Swipeable>
  );
}

/**
 * Delivery channels only — which of push/email/in-app each category uses.
 * Per-activity and per-kind reminder subscriptions live on the Schedule
 * tab's own bell/settings sheet now, not here.
 */
const PreferencesView = memo(function PreferencesView({
  tabSwitcher,
  androidTopInset,
}: {
  tabSwitcher: ReactNode;
  androidTopInset: number;
}) {
  const { t } = useLocale();
  const { me } = useMeContext();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const actionRetry = useRef<(() => Promise<void>) | null>(null);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);

  useScrollToTop(scrollRef);

  const fetchPreferences = useCallback(
    () => apiFetch<Preferences>("/api/me/notification-preferences"),
    [],
  );
  const {
    data: prefs,
    loading,
    error,
    staleSince,
    load,
    setData,
  } = useCachedApi(`user:${me?.id ?? "unknown"}:notification-preferences`, fetchPreferences);

  useEffect(() => {
    void load();
  }, [load]);

  // Keeps this tab in sync with toggles made elsewhere (e.g. the schedule
  // bell), which mount their own independent cache instance for the same
  // preferences (H51).
  useEffect(() => subscribeToNotificationChanges(() => void load()), [load]);

  function enabledFor(category: string, channel: Channel): boolean {
    const override = prefs?.overrides.find(
      (row) => row.category === category && row.channel === channel,
    );
    return override ? override.enabled : category !== "queue.staff";
  }

  async function toggle(category: string, channel: Channel, enabled: boolean) {
    if (!prefs) return;
    const key = `${category}:${channel}`;
    const previous = prefs;
    actionRetry.current = () => toggle(category, channel, enabled);
    setSavingKey(key);
    setActionError(null);
    // Optimistic: flip instantly, reconcile with the server in the
    // background — only revert if the request actually fails.
    setData(withOverride(prefs, category, channel, enabled));
    void haptic("selection");
    try {
      const next = await savePreferences([{ category, channel, enabled }]);
      setData(next);
      emitNotificationChange();
    } catch (cause) {
      setData(previous);
      setActionError(cause instanceof Error ? cause : new Error("Failed to save preference"));
    } finally {
      setSavingKey(null);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const scrollProps = {
    ref: scrollRef,
    contentInsetAdjustmentBehavior: "automatic" as const,
    contentContainerStyle: {
      gap: 18,
      padding: 16,
      paddingBottom: Math.max(32, tabBarBottomInset + 16),
      paddingTop: 16 + androidTopInset,
    },
    keyboardShouldPersistTaps: "handled" as const,
    refreshControl: <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />,
  };

  if (!prefs)
    return (
      <ScrollView {...scrollProps}>
        {tabSwitcher}
        <RequestFeedback loading={loading} error={error} onRetry={() => void load()} />
      </ScrollView>
    );

  // Application decisions are email-only and intentionally have no mobile
  // preference: accepted/rejected applicants must always receive them.
  const editableCategories = ["announcements", "schedule"];
  const capabilities = me?.capabilities ?? [];
  const canReceiveQueueStaffAlerts =
    capabilities.includes(CAPABILITIES.ADMIN_ALL) ||
    capabilities.includes(CAPABILITIES.QUEUE_OPERATE) ||
    capabilities.includes(CAPABILITIES.QUEUE_ADMIN) ||
    capabilities.includes(CAPABILITIES.JUDGE_PANEL);
  const retryAction = actionRetry.current;

  return (
    <ScrollView {...scrollProps}>
      {tabSwitcher}
      <StaleDataBanner updatedAt={staleSince} />
      {actionError ? (
        <RequestFeedback
          error={actionError}
          onRetry={retryAction ? () => void retryAction() : undefined}
          retrying={savingKey !== null}
        />
      ) : null}
      <Section title={t("notificationsRequired")} footer={t("notificationsMandatoryHint")}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            minHeight: 50,
            paddingHorizontal: 16,
          }}
        >
          <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
            {t("queueCalls")}
          </Text>
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
            {t("notificationsAlwaysOn")}
          </Text>
        </View>
      </Section>

      {canReceiveQueueStaffAlerts ? (
        <Section title={t("notificationsQueueStaff")} footer={t("notificationsQueueStaffHint")}>
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              minHeight: 50,
              paddingHorizontal: 16,
            }}
          >
            <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
              {t("notificationsPush")}
            </Text>
            <Switch
              accessibilityLabel={`${t("notificationsQueueStaff")}, ${t("notificationsPush")}`}
              disabled={savingKey !== null}
              style={{ alignSelf: "center" }}
              value={enabledFor("queue.staff", "push")}
              onValueChange={(enabled) => void toggle("queue.staff", "push", enabled)}
            />
          </View>
        </Section>
      ) : null}

      {editableCategories.map((category) => (
        <Section key={category} title={categoryLabel(category, t)}>
          {validChannels(prefs.channels).map((channel, index) => {
            return (
              <View key={channel}>
                {index > 0 ? <Separator /> : null}
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    minHeight: 50,
                    paddingHorizontal: 16,
                  }}
                >
                  <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
                    {channelLabel(channel, t)}
                  </Text>
                  <Switch
                    accessibilityLabel={`${categoryLabel(category, t)}, ${channelLabel(channel, t)}`}
                    disabled={savingKey !== null}
                    style={{ alignSelf: "center" }}
                    value={enabledFor(category, channel)}
                    onValueChange={(enabled) => void toggle(category, channel, enabled)}
                  />
                </View>
              </View>
            );
          })}
        </Section>
      ))}
    </ScrollView>
  );
});

function savePreferences(
  preferences: Array<{ category: string; channel: Channel; enabled: boolean }>,
) {
  return apiFetch<Preferences>("/api/me/notification-preferences", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
}

function payloadField(payload: unknown, key: "subject" | "body") {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

const HIDDEN_PAYLOAD_KEYS = new Set([
  "subject",
  "body",
  "template",
  "vars",
  "recipient",
  "language",
]);

// Technical identifiers (entryId, roomId, activityId, teamId, …) are only
// meaningful to the backend; showing them as raw "Entry Id: 42" rows read as
// ugly, unexplained metadata rather than information a participant can use.
const TECHNICAL_ID_KEY = /(^id$|Id$)/;

function payloadDetails(payload: unknown, t: ReturnType<typeof useLocale>["t"]) {
  if (!payload || typeof payload !== "object") return [];
  return Object.entries(payload as Record<string, unknown>)
    .filter(
      ([key, value]) =>
        !HIDDEN_PAYLOAD_KEYS.has(key) &&
        !TECHNICAL_ID_KEY.test(key) &&
        value !== null &&
        value !== undefined &&
        typeof value !== "object",
    )
    .map(([key, value]) => ({
      key: payloadDetailLabel(key, t),
      value: String(value),
    }));
}

function payloadDetailLabel(key: string, t: ReturnType<typeof useLocale>["t"]): string {
  const labels: Record<string, string> = {
    activityTitle: t("notificationsDetailActivity"),
    applicationName: t("notificationsDetailApplication"),
    challengeName: t("notificationsDetailChallenge"),
    challengeTitle: t("notificationsDetailChallenge"),
    decision: t("notificationsDetailDecision"),
    decisionDetails: t("notificationsDetailDecision"),
    etaMinutes: t("notificationsDetailWait"),
    locationLine: t("notificationsDetailLocation"),
    locationSuffix: t("notificationsDetailLocation"),
    message: t("notificationsDetailMessage"),
    name: t("notificationsDetailName"),
    roomName: t("notificationsDetailRoom"),
    senderName: t("notificationsDetailSender"),
    startsAtLabel: t("notificationsDetailStarts"),
    teamName: t("notificationsDetailTeam"),
    title: t("notificationsDetailActivity"),
  };
  return (
    labels[key] ??
    key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())
  );
}

function categoryLabel(category: string, t: ReturnType<typeof useLocale>["t"]) {
  if (category === "announcements") return t("notificationsAnnouncements");
  if (category === "schedule") return t("notificationsActivityReminders");
  return t("notificationsApplications");
}

function channelLabel(channel: Channel, t: ReturnType<typeof useLocale>["t"]) {
  const labels: Record<Channel, string> = {
    in_app: t("notificationsInApp"),
    email: t("emailLabel"),
    push: t("notificationsPush"),
  };
  return labels[channel];
}
