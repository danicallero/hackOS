import { EVENTS } from "@hackos/shared/events";
import { useNavigation, useRouter, useScrollToTop } from "expo-router";
import Stack from "expo-router/stack";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AppState,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  type ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import {
  GestureDetector,
  type NativeGesture,
  useNativeGesture,
} from "react-native-gesture-handler";
import Swipeable, {
  type SwipeableMethods,
  type SwipeableProps,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EmptyState, LegacyHeaderIconButton, Section, Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { alert } from "@/lib/alert";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  emitNotificationChange,
  subscribeToCategory,
  subscribeToNotificationChanges,
} from "@/lib/notification-events";
import type { NotificationChannel } from "@/lib/notification-preferences";
import { subscribeToServerEvent } from "@/lib/server-events";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors, radius, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

type Channel = NotificationChannel;
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

/**
 * Android's scroll recognizer must participate in notification-row swipes:
 * without this native gesture boundary, a mostly vertical drag can be claimed
 * by Swipeable and reveal the delete action instead of scrolling the inbox.
 */
function NotificationScrollGestureBoundary({
  enabled,
  gesture,
  children,
}: {
  enabled: boolean;
  gesture: NativeGesture;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

/**
 * Where the alerts gear lands: Account, with the Notifications row
 * highlighted once so people learn where preferences live (H51).
 */
export function alertsPreferencesHref() {
  // A fresh `highlightAt` per tap lets Account replay the scroll even when it
  // is already mounted (or focused) and the highlight value is unchanged.
  return {
    pathname: "/(tabs)/others/account",
    params: { highlight: "notifications", highlightAt: String(Date.now()) },
  } as const;
}

/**
 * H51: the inbox viewer, presented as a sheet from the Schedule bell. Read,
 * unread and delete live on each row; every notification setting is in
 * Account → Notifications.
 */
export default function AlertsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const navigation = useNavigation();
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const glassAvailable = isRealLiquidGlassAvailable();
  const filterIcon = unreadOnly ? "envelope.badge.fill" : "envelope.badge";

  const toggleUnread = useCallback(() => {
    void haptic("selection");
    setUnreadOnly((current) => !current);
  }, []);
  const close = useCallback(() => router.dismiss(), [router]);
  // Dismiss first so the Schedule stack does not keep the sheet on top.
  const openPreferences = useCallback(() => {
    router.dismiss();
    router.navigate(alertsPreferencesHref());
  }, [router]);

  // Liquid Glass owns the toolbar grouping below; other platforms get the
  // same controls as plain header buttons.
  useLayoutEffect(() => {
    if (glassAvailable) return;
    navigation.setOptions({
      headerLeft: () => (
        <LegacyHeaderIconButton icon="xmark" accessibilityLabel={t("close")} onPress={close} />
      ),
      headerRight: () => (
        <View style={{ flexDirection: "row" }}>
          <LegacyHeaderIconButton
            icon={filterIcon}
            accessibilityLabel={t("notificationsUnreadOnly")}
            accessibilityState={{ selected: unreadOnly }}
            tintColor={unreadOnly ? colors.accent : colors.label}
            onPress={toggleUnread}
          />
          <LegacyHeaderIconButton
            icon="gearshape"
            accessibilityLabel={t("notificationsPreferences")}
            onPress={openPreferences}
          />
        </View>
      ),
    });
  }, [close, filterIcon, glassAvailable, navigation, openPreferences, t, toggleUnread, unreadOnly]);

  return (
    <>
      {glassAvailable ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="xmark" accessibilityLabel={t("close")} onPress={close} />
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon={filterIcon}
              accessibilityLabel={t("notificationsUnreadOnly")}
              selected={unreadOnly}
              tintColor={unreadOnly ? colors.accent : undefined}
              onPress={toggleUnread}
            />
            <Stack.Toolbar.Button
              icon="gearshape"
              accessibilityLabel={t("notificationsPreferences")}
              onPress={openPreferences}
            />
          </Stack.Toolbar>
        </>
      ) : null}
      <MessagesView unreadOnly={unreadOnly} />
    </>
  );
}

const MessagesView = memo(function MessagesView({ unreadOnly }: { unreadOnly: boolean }) {
  const { t, language } = useLocale();
  const readable = useParticipantLayout("list");
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
  // Presented as a sheet over the tab bar, so only the home indicator needs clearing.
  const { bottom: bottomInset } = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const notificationScrollGuardEnabled = Platform.OS === "android";
  const notificationScrollGesture = useNativeGesture({ enabled: notificationScrollGuardEnabled });

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
  const all = useCachedApi(`user:${me?.id ?? "unknown"}:notifications:all`, fetchAll, {
    enabled: me !== null,
    pollMs: 30_000,
  });
  const unread = useCachedApi(`user:${me?.id ?? "unknown"}:notifications:unread`, fetchUnread, {
    enabled: me !== null,
    pollMs: 30_000,
  });
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
    const unsubscribeCategory = subscribeToCategory("announcements", reload);
    const unsubscribeChanges = subscribeToNotificationChanges(reload);
    const unsubscribeServer = subscribeToServerEvent(EVENTS.USER_NOTIFICATION, reload);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reload();
    });
    return () => {
      unsubscribeCategory();
      unsubscribeChanges();
      unsubscribeServer();
      appStateSubscription.remove();
    };
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
      // until the user collapses it again (#489): removing it immediately
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

  async function markUnread(item: InboxItem) {
    if (!item.read_at) return;
    actionRetry.current = () => markUnread(item);
    setReadingId(item.id);
    setActionError(null);
    try {
      await apiFetch<{ id: number; read_at: null }>(`/api/me/notifications/${item.id}/unread`, {
        method: "POST",
      });
      updateBothCaches(item.id, (row) => ({ ...row, read_at: null }));
      // The unread list is its own server page; refetch so the item reappears there.
      void unread.load();
      emitNotificationChange();
      void haptic("selection");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error(t("alertsCouldNotUpdate")));
    } finally {
      setReadingId(null);
    }
  }

  function toggleRead(item: InboxItem) {
    if (item.read_at) void markUnread(item);
    else void markRead(item);
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
      // grace period is over, so it can now drop out of the list (#489).
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
    alert(t("notificationsDeleteTitle"), t("notificationsDeleteBody"), [
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
    <NotificationScrollGestureBoundary
      enabled={notificationScrollGuardEnabled}
      gesture={notificationScrollGesture}
    >
      <Animated.ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 16,
          ...readable.content,
          paddingBottom: Math.max(32, bottomInset + 16),
          paddingTop: 16,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        onScroll={Platform.OS === "ios" ? scrollHandler : undefined}
        onScrollEndDrag={Platform.OS === "android" ? loadMoreAtAndroidEnd : undefined}
        onMomentumScrollEnd={Platform.OS === "android" ? loadMoreAtAndroidEnd : undefined}
        scrollEventThrottle={1}
      >
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
                  onToggleRead={() => toggleRead(item)}
                  scrollGesture={
                    notificationScrollGuardEnabled ? notificationScrollGesture : undefined
                  }
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
              style={{
                color: colors.secondaryLabel,
                fontSize: type.footnote.fontSize,
                textAlign: "center",
              }}
            >
              {t("notificationsShowingLatest", {
                count: String(data.items.length),
                total: String(data.total),
              })}
            </Text>
            {data.items.length < data.total ? (
              Platform.OS === "android" ? (
                <PressableFeedback
                  feedback="opacity"
                  accessibilityLabel={t("notificationsPullToLoadMore")}
                  accessibilityRole="button"
                  accessibilityState={{ busy: loadingMore, disabled: loadingMore }}
                  disabled={loadingMore}
                  onPress={() => void loadMoreRef.current()}
                  style={{
                    alignItems: "center",
                    height: 44,
                    justifyContent: "center",
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {loadMoreIndicator}
                </PressableFeedback>
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
    </NotificationScrollGestureBoundary>
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
      <Text
        selectable={false}
        style={{ color: colors.tertiaryLabel, fontSize: type.caption.fontSize }}
      >
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
      <PressableFeedback
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={t("notificationsDelete")}
        onPress={onDelete}
        style={{
          alignItems: "center",
          backgroundColor: colors.destructive,
          borderCurve: "continuous",
          flexDirection: "row",
          gap: 6,
          height: "100%",
          justifyContent: "center",
          paddingHorizontal: 18,
        }}
      >
        <SymbolView name="trash.fill" tintColor={colors.accentText} size={16} accessible={false} />
        <Text
          style={{ color: colors.accentText, fontSize: type.compact.fontSize, fontWeight: "700" }}
        >
          {t("notificationsDelete")}
        </Text>
      </PressableFeedback>
    </Animated.View>
  );
}

/** H51: swiping right reveals read/unread, like Mail's leading swipe action. */
function ReadRevealAction({
  progress,
  unread,
  onPress,
}: {
  progress: SharedValue<number>;
  unread: boolean;
  onPress: () => void;
}) {
  const { t } = useLocale();
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  const label = unread ? t("alertsMarkRead") : t("alertsMarkUnread");
  return (
    <Animated.View style={[{ justifyContent: "center", marginRight: 8 }, style]}>
      <PressableFeedback
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={{
          alignItems: "center",
          backgroundColor: colors.accent,
          borderCurve: "continuous",
          flexDirection: "row",
          gap: 6,
          height: "100%",
          justifyContent: "center",
          paddingHorizontal: 18,
        }}
      >
        <SymbolView
          name={unread ? "envelope" : "envelope.badge.fill"}
          tintColor={colors.accentText}
          size={16}
          accessible={false}
        />
        <Text
          style={{ color: colors.accentText, fontSize: type.compact.fontSize, fontWeight: "700" }}
        >
          {label}
        </Text>
      </PressableFeedback>
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
  onToggleRead,
  scrollGesture,
}: {
  item: InboxItem;
  expanded: boolean;
  language: string;
  onPress: () => void;
  busy: boolean;
  deleting: boolean;
  onDelete: () => void;
  onToggleRead: () => void;
  scrollGesture?: NativeGesture;
}) {
  const swipeableRef = useRef<SwipeableMethods>(null);
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
      ref={swipeableRef}
      enabled={!deleting && !busy}
      renderLeftActions={(progress) => (
        <ReadRevealAction
          progress={progress}
          unread={unread}
          onPress={() => {
            swipeableRef.current?.close();
            onToggleRead();
          }}
        />
      )}
      renderRightActions={(progress) => (
        <DeleteRevealAction progress={progress} onDelete={onDelete} />
      )}
      leftThreshold={40}
      rightThreshold={40}
      simultaneousWith={scrollGesture as SwipeableProps["simultaneousWith"]}
      onSwipeableOpenStartDrag={() => {
        swiping.current = true;
      }}
      onSwipeableCloseStartDrag={() => {
        swiping.current = true;
      }}
      onSwipeableWillOpen={stopSwiping}
      onSwipeableWillClose={stopSwiping}
    >
      <PressableFeedback
        accessibilityRole="button"
        accessibilityState={{ busy: busy || deleting, expanded }}
        feedback="row"
        onPress={() => {
          if (swiping.current || busy || deleting) return;
          void haptic("light");
          onPress();
        }}
        style={{
          backgroundColor: colors.surface,
          gap: 9,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={unread ? "notification-unread-dot" : undefined}
            style={{
              backgroundColor: unread ? colors.accent : colors.transparent,
              borderRadius: radius.full,
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
                  fontSize: type.callout.fontSize,
                  fontWeight: unread ? "700" : "500",
                }}
              >
                {subject}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.tertiaryLabel,
                  fontSize: type.caption.fontSize,
                  fontVariant: ["tabular-nums"],
                }}
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
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.compact.fontSize,
                  lineHeight: 20,
                }}
              >
                {body}
              </Text>
            ) : null}
            {expanded && details.length ? (
              <View
                style={{
                  backgroundColor: colors.background,
                  borderCurve: "continuous",
                  borderRadius: radius.chip,
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
                        fontSize: type.caption.fontSize,
                      }}
                    >
                      {detail.key}
                    </Text>
                    <Text
                      selectable
                      style={{ color: colors.label, flex: 1, fontSize: type.caption.fontSize }}
                    >
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
      </PressableFeedback>
    </Swipeable>
  );
}

/**
 * Delivery channels only — which of push/email/in-app each category uses.
 * Per-activity and per-kind reminder subscriptions live on the Schedule
 * tab's own bell/settings sheet now, not here.
 */
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
