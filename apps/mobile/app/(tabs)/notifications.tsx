import { MenuView } from "@expo/ui/community/menu";
import { ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  useColorScheme,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { ActionButton, EmptyState, Section, Separator } from "@/components/native-ui";
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
import { fetchPublicSchedule, type ScheduleItem } from "@/lib/schedule";
import { subscribeToServerEvent } from "@/lib/server-events";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

type Channel = "in_app" | "email" | "push" | "discord";

interface Preferences {
  channels: Channel[];
  mandatoryCategories: string[];
  overrides: { category: string; channel: Channel; enabled: boolean }[];
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
const REMINDER_DEFAULT_CHANNELS: Channel[] = ["in_app", "email", "push"];

/** Full in-app inbox and notification preferences, matching the web participant view. */
export default function NotificationsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const androidTopInset = useAndroidTopInset();

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 18,
        padding: 16,
        paddingBottom: 32,
        paddingTop: 16 + androidTopInset,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <SegmentedControl
        label={t("tabNotifications")}
        values={[t("notificationsMessages"), t("notificationsPreferences")]}
        selectedIndex={selectedIndex}
        onChange={setSelectedIndex}
      />
      {selectedIndex === 0 ? <MessagesView /> : <PreferencesView />}
    </ScrollView>
  );
}

function MessagesView() {
  const { t, language } = useLocale();
  const { me } = useMeContext();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [actionError, setActionError] = useState<Error | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [readingId, setReadingId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const actionRetry = useRef<(() => Promise<void>) | null>(null);

  const fetchInbox = useCallback(async () => {
    const query = unreadOnly ? "&unread=true" : "";
    return apiFetch<InboxResponse>(`/api/me/notifications?limit=${LIMIT}&offset=0${query}`);
  }, [unreadOnly]);
  const { data, loading, error, staleSince, load, setData } = useCachedApi(
    `user:${me?.id ?? "unknown"}:notifications:${unreadOnly ? "unread" : "all"}`,
    fetchInbox,
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToCategory("announcements", () => void load()), [load]);
  useEffect(() => subscribeToServerEvent(EVENTS.USER_NOTIFICATION, () => void load()), [load]);

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
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((row) =>
                row.id === item.id ? { ...row, read_at: result.read_at } : row,
              ),
            }
          : current,
      );
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
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (!item.read_at) void markRead(item);
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
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.filter((row) => row.id !== item.id),
              total: Math.max(0, current.total - 1),
            }
          : current,
      );
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
    if (!data || loadingMore || data.items.length >= data.total) return;
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
      setLoadingMore(false);
    }
  }

  const items = data?.items ?? [];
  const retryAction = actionRetry.current;
  const actionRetrying = readingId !== null || deletingId !== null || loadingMore;

  return (
    <View style={{ gap: 16 }}>
      <StaleDataBanner updatedAt={staleSince} onRetry={() => void load()} retrying={loading} />
      <Section footer={t("notificationsUnreadHint")}>
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            minHeight: 50,
            paddingHorizontal: 16,
          }}
        >
          <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
            {t("notificationsUnreadOnly")}
          </Text>
          <Switch
            accessibilityLabel={t("notificationsUnreadOnly")}
            style={{ alignSelf: "center" }}
            value={unreadOnly}
            onValueChange={setUnreadOnly}
          />
        </View>
      </Section>

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
        <View style={{ gap: 8 }}>
          <Text
            selectable
            style={{ color: colors.secondaryLabel, fontSize: 13, textAlign: "center" }}
          >
            {t("notificationsShowingLatest", {
              count: String(data.items.length),
              total: String(data.total),
            })}
          </Text>
          {data.items.length < data.total ? (
            <ActionButton
              label={t("notificationsLoadMore")}
              icon="chevron.down"
              busy={loadingMore}
              onPress={() => void loadMore()}
            />
          ) : null}
        </View>
      ) : null}

      <ActionButton
        label={t("refreshNotifications")}
        icon="arrow.clockwise"
        busy={loading}
        onPress={() => void load()}
      />
    </View>
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

function PreferencesView() {
  const { t } = useLocale();
  const { me } = useMeContext();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);
  const actionRetry = useRef<(() => Promise<void>) | null>(null);
  const [removalStates, setRemovalStates] = useState<
    Record<string, "queued" | "removing" | "failed">
  >({});
  const removalQueue = useRef<Array<{ category: string; channels: Channel[] }>>([]);
  const queuedRemovalCategories = useRef(new Set<string>());
  const processingRemovals = useRef(false);

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
  const {
    data: scheduleData,
    loading: scheduleLoading,
    error: scheduleError,
    load: loadSchedule,
  } = useCachedApi("schedule", fetchPublicSchedule);
  const scheduleItems = scheduleData ?? [];

  useEffect(() => {
    void load();
    void loadSchedule();
  }, [load, loadSchedule]);

  // Keeps this tab in sync with reminder toggles made elsewhere (e.g. the
  // schedule card/detail bell), which mount their own independent cache
  // instance for the same preferences (H51).
  useEffect(() => subscribeToNotificationChanges(() => void load()), [load]);

  function enabledFor(category: string, channel: Channel): boolean {
    const override = prefs?.overrides.find(
      (row) => row.category === category && row.channel === channel,
    );
    return override ? override.enabled : category !== "queue.staff";
  }

  async function toggle(category: string, channel: Channel, enabled: boolean) {
    const key = `${category}:${channel}`;
    actionRetry.current = () => toggle(category, channel, enabled);
    setSavingKey(key);
    setActionError(null);
    try {
      const next = await savePreferences([{ category, channel, enabled }]);
      setData(next);
      emitNotificationChange();
      void haptic("selection");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error("Failed to save preference"));
    } finally {
      setSavingKey(null);
    }
  }

  async function addReminder(category: string) {
    actionRetry.current = () => addReminder(category);
    setSavingKey(category);
    setActionError(null);
    try {
      const next = await savePreferences(
        REMINDER_DEFAULT_CHANNELS.map((channel) => ({ category, channel, enabled: true })),
      );
      setData(next);
      emitNotificationChange();
      void haptic("selection");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause : new Error(t("notificationsCouldNotAdd")));
    } finally {
      setSavingKey(null);
    }
  }

  async function drainRemovalQueue() {
    if (processingRemovals.current) return;
    processingRemovals.current = true;
    let changed = false;
    while (removalQueue.current.length > 0) {
      const operation = removalQueue.current.shift();
      if (!operation) continue;
      setRemovalStates((current) => ({ ...current, [operation.category]: "removing" }));
      try {
        const next = await savePreferences(
          operation.channels.map((channel) => ({
            category: operation.category,
            channel,
            enabled: false,
          })),
        );
        setData(next);
        setRemovalStates((current) => {
          const nextStates = { ...current };
          delete nextStates[operation.category];
          return nextStates;
        });
        void haptic("selection");
        changed = true;
      } catch (cause) {
        setRemovalStates((current) => ({ ...current, [operation.category]: "failed" }));
        setActionError(
          cause instanceof Error ? cause : new Error(t("notificationsCouldNotRemove")),
        );
      } finally {
        queuedRemovalCategories.current.delete(operation.category);
      }
    }
    processingRemovals.current = false;
    if (changed) emitNotificationChange();
  }

  function enqueueReminderRemoval(category: string, channels: Channel[]) {
    if (queuedRemovalCategories.current.has(category)) return;
    actionRetry.current = () => {
      enqueueReminderRemoval(category, channels);
      return Promise.resolve();
    };
    queuedRemovalCategories.current.add(category);
    setRemovalStates((current) => ({ ...current, [category]: "queued" }));
    removalQueue.current.push({ category, channels });
    void drainRemovalQueue();
  }

  if (!prefs)
    return <RequestFeedback loading={loading} error={error} onRetry={() => void load()} />;

  // Application decisions are email-only and intentionally have no mobile
  // preference: accepted/rejected applicants must always receive them.
  const editableCategories = ["announcements", "schedule"];
  const capabilities = me?.capabilities ?? [];
  const canReceiveQueueStaffAlerts =
    capabilities.includes(CAPABILITIES.ADMIN_ALL) ||
    capabilities.includes(CAPABILITIES.QUEUE_OPERATE) ||
    capabilities.includes(CAPABILITIES.QUEUE_ADMIN) ||
    capabilities.includes(CAPABILITIES.JUDGE_PANEL);
  const enabledReminderCategories = [
    ...new Set(
      prefs.overrides
        .filter((row) => row.enabled && row.category.startsWith("schedule:"))
        .map((row) => row.category),
    ),
  ];
  const individualReminders = enabledReminderCategories.filter(
    (category) => !category.startsWith("schedule:type:"),
  );
  const kindReminders = enabledReminderCategories.filter((category) =>
    category.startsWith("schedule:type:"),
  );
  const upcomingItems = scheduleItems.filter(
    (item) => new Date(item.endsAt).getTime() > Date.now(),
  );
  const addableActivities = upcomingItems.filter(
    (item) => !individualReminders.includes(`schedule:${item.id}`),
  );
  const addableKinds = [
    ...new Set([
      ...ACTIVITY_KINDS,
      ...scheduleItems.map((item) => item.type).filter((kind): kind is string => !!kind),
    ]),
  ].filter((kind) => !kindReminders.includes(`schedule:type:${kind}`));
  const pendingRemovalCount = Object.values(removalStates).filter(
    (state) => state === "queued" || state === "removing",
  ).length;
  const retryAction = actionRetry.current;

  return (
    <View style={{ gap: 18 }}>
      <StaleDataBanner updatedAt={staleSince} onRetry={() => void load()} retrying={loading} />
      {actionError ? (
        <RequestFeedback
          error={actionError}
          onRetry={retryAction ? () => void retryAction() : undefined}
          retrying={savingKey !== null || pendingRemovalCount > 0}
        />
      ) : null}
      <Section title={t("notificationsRequired")} footer={t("notificationsMandatoryHint")}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 12, padding: 16 }}>
          <SymbolView
            name="bell.badge.fill"
            tintColor={colors.accent}
            size={22}
            accessible={false}
          />
          <Text
            selectable
            style={{ color: colors.label, flex: 1, fontSize: 16, fontWeight: "600" }}
          >
            {t("queueCalls")}
          </Text>
          <View style={{ alignItems: "center", flexDirection: "row", gap: 4 }}>
            <SymbolView
              name="lock.fill"
              tintColor={colors.secondaryLabel}
              size={13}
              accessible={false}
            />
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
              {t("notificationsAlwaysOn")}
            </Text>
          </View>
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
              disabled={savingKey !== null || pendingRemovalCount > 0}
              style={{ alignSelf: "center" }}
              value={enabledFor("queue.staff", "push")}
              onValueChange={(enabled) => void toggle("queue.staff", "push", enabled)}
            />
          </View>
        </Section>
      ) : null}

      {editableCategories.map((category) => (
        <Section key={category} title={categoryLabel(category, t)}>
          {prefs.channels.map((channel, index) => {
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
                    disabled={savingKey !== null || pendingRemovalCount > 0}
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

      <Section
        title={t("notificationsActivityReminders")}
        footer={t("notificationsActivityRemindersHint")}
      >
        {pendingRemovalCount > 0 ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            style={{
              alignItems: "center",
              backgroundColor: colors.elevatedSurface,
              flexDirection: "row",
              gap: 10,
              minHeight: 46,
              paddingHorizontal: 16,
            }}
          >
            <ActivityIndicator color={colors.accent} size="small" />
            <Text selectable style={{ color: colors.secondaryLabel, flex: 1, fontSize: 14 }}>
              {t("notificationsRemovalProgress", { count: String(pendingRemovalCount) })}
            </Text>
          </View>
        ) : null}
        {pendingRemovalCount > 0 && enabledReminderCategories.length > 0 ? <Separator /> : null}
        {enabledReminderCategories.length === 0 ? (
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14, padding: 16 }}>
            {t("notificationsNoActiveReminders")}
          </Text>
        ) : (
          enabledReminderCategories.map((category, index) => {
            const label = reminderCategoryLabel(category, scheduleItems, t);
            const removalState = removalStates[category];
            const removalBusy = removalState === "queued" || removalState === "removing";
            return (
              <View key={category}>
                {index > 0 ? <Separator /> : null}
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: 10,
                    minHeight: 54,
                    paddingLeft: 16,
                  }}
                >
                  <View style={{ flex: 1, gap: 2, paddingVertical: 9 }}>
                    <Text selectable style={{ color: colors.label, fontSize: 16 }}>
                      {label}
                    </Text>
                    {removalState ? (
                      <Text
                        selectable
                        accessibilityRole={removalState === "failed" ? "alert" : undefined}
                        style={{
                          color:
                            removalState === "failed" ? colors.destructive : colors.secondaryLabel,
                          fontSize: 12,
                        }}
                      >
                        {removalState === "queued"
                          ? t("notificationsRemovalQueued")
                          : removalState === "removing"
                            ? t("notificationsRemoving")
                            : t("notificationsCouldNotRemove")}
                      </Text>
                    ) : null}
                  </View>
                  <ActionButton
                    label={removalState === "failed" ? t("retry") : t("notificationsTurnOff")}
                    busy={removalBusy}
                    disabled={savingKey !== null}
                    destructive
                    haptic={false}
                    onPress={() => enqueueReminderRemoval(category, prefs.channels)}
                    style={{ minHeight: 54 }}
                  />
                </View>
              </View>
            );
          })
        )}
      </Section>

      <Section title={t("notificationsAddActivityReminder")}>
        {scheduleLoading && !scheduleItems.length ? (
          <View style={{ alignItems: "center", minHeight: 50, justifyContent: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : scheduleError ? (
          <ActionButton
            label={t("retry")}
            icon="arrow.clockwise"
            onPress={() => void loadSchedule()}
          />
        ) : addableActivities.length === 0 ? (
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14, padding: 16 }}>
            {t("notificationsNoUpcomingActivities")}
          </Text>
        ) : (
          <MenuView
            actions={addableActivities.map((item) => ({
              id: String(item.id),
              title: item.title,
            }))}
            onPressAction={({ nativeEvent }) => void addReminder(`schedule:${nativeEvent.event}`)}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: savingKey !== null || pendingRemovalCount > 0 }}
              disabled={savingKey !== null || pendingRemovalCount > 0}
            >
              <ReminderPickerRow label={t("notificationsChooseActivity")} />
            </Pressable>
          </MenuView>
        )}
      </Section>

      <Section title={t("notificationsAddKindReminder")}>
        <MenuView
          actions={addableKinds.map((kind) => ({
            id: kind,
            title: activityKindLabel(kind, t),
          }))}
          onPressAction={({ nativeEvent }) =>
            void addReminder(`schedule:type:${nativeEvent.event}`)
          }
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{
              disabled: savingKey !== null || pendingRemovalCount > 0 || addableKinds.length === 0,
            }}
            disabled={savingKey !== null || pendingRemovalCount > 0 || addableKinds.length === 0}
          >
            <ReminderPickerRow
              label={
                addableKinds.length > 0
                  ? t("notificationsChooseKind")
                  : t("notificationsAllKindsEnabled")
              }
            />
          </Pressable>
        </MenuView>
      </Section>

      <ActionButton
        label={t("refreshNotifications")}
        icon="arrow.clockwise"
        busy={loading}
        onPress={() => void load()}
      />
    </View>
  );
}

function ReminderPickerRow({ label }: { label: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        minHeight: 50,
        paddingHorizontal: 16,
      }}
    >
      <SymbolView name="plus.circle.fill" tintColor={colors.accent} size={20} accessible={false} />
      <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
        {label}
      </Text>
      <SymbolView
        name="chevron.down"
        tintColor={colors.tertiaryLabel}
        size={13}
        accessible={false}
      />
    </View>
  );
}

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

function activityKindLabel(kind: string, t: ReturnType<typeof useLocale>["t"]): string {
  const labels: Record<string, string> = {
    activity: t("notificationsKindActivity"),
    meal: t("notificationsKindMeal"),
    workshop: t("notificationsKindWorkshop"),
    talk: t("notificationsKindTalk"),
    ceremony: t("notificationsKindCeremony"),
    other: t("notificationsKindOther"),
  };
  return labels[kind] ?? kind;
}

function reminderCategoryLabel(
  category: string,
  scheduleItems: ScheduleItem[],
  t: ReturnType<typeof useLocale>["t"],
): string {
  if (category.startsWith("schedule:type:")) {
    return t("notificationsAllKind", {
      kind: activityKindLabel(category.slice("schedule:type:".length), t),
    });
  }
  const id = Number(category.slice("schedule:".length));
  const item = scheduleItems.find((candidate) => candidate.id === id);
  return item?.title ?? t("notificationsUnavailableActivity", { id: String(id) });
}

function channelLabel(channel: Channel, t: ReturnType<typeof useLocale>["t"]) {
  const labels: Record<Channel, string> = {
    in_app: t("notificationsInApp"),
    email: t("emailLabel"),
    push: t("notificationsPush"),
    discord: "Discord",
  };
  return labels[channel];
}
