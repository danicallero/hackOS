import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  AppSwitch,
  EmptyState,
  InfoRow,
  Section,
  Separator,
  SWITCH_IN_ROW_STYLE,
  ToggleRow,
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { eventDayKey, formatEventTime, useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import {
  fetchPublicSchedule,
  resolveScheduleText,
  type ScheduleItem,
  scheduleTypeLabel,
} from "@/lib/schedule";
import { useCachedApi } from "@/lib/use-cached-api";
import {
  itemCategory,
  kindCategory,
  useScheduleNotifications,
} from "@/lib/use-schedule-notifications";
import { useStreamRefresh } from "@/lib/use-stream-refresh";
import { colors } from "@/theme/colors";

/** "Coming up" shows this many reminders before "See all" (H59). */
export const UPCOMING_PREVIEW_LIMIT = 3;

/**
 * Reminder rows reserve a leading column for the start time, wide enough for
 * the locale's longest time ("10:00 PM" in 12-hour locales, "22:00" in 24-hour
 * ones) so it never wraps and every row's title starts at the same edge.
 */
function useTimeColumnWidth() {
  const { language } = useLocale();
  return useMemo(() => {
    const sample = new Date(2000, 0, 1, 22, 0).toLocaleTimeString(language, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return /[^\d\s:.,]/.test(sample) ? 76 : 50;
  }, [language]);
}

function rowSeparatorInset(timeColumnWidth: number) {
  return 16 + timeColumnWidth + 12;
}

/**
 * H59: the schedule plus the person's reminder preferences, sharing the
 * Schedule tab's cache so both surfaces show the same activities and every
 * toggle propagates through the preference-change channel.
 */
export function useScheduleReminders() {
  const { language } = useLocale();
  const { data, loading, error, staleSince, load } = useCachedApi("schedule", fetchPublicSchedule);
  useStreamRefresh(() => void load(), { publicContent: true });
  const items = useMemo(
    () =>
      (data ?? [])
        .map((item) => ({ ...item, ...resolveScheduleText(item, language) }))
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
    [data, language],
  );
  const notifications = useScheduleNotifications(items);
  const kinds = useMemo(
    () =>
      [
        ...new Set(items.map((item) => item.type).filter((type): type is string => Boolean(type))),
      ].sort(),
    [items],
  );

  useEffect(() => {
    void load();
    void notifications.load();
  }, [load, notifications.load]);

  const reload = useCallback(async () => {
    await Promise.all([load(), notifications.load()]);
  }, [load, notifications.load]);

  return { items, kinds, notifications, loading, error, staleSince, reload };
}

function isUpcoming(item: ScheduleItem, now: number) {
  return Date.parse(item.endsAt) > now;
}

/**
 * H59: the reminder part of Account → Notifications → Activity reminders,
 * below the channel switches: a bulk switch per activity type, then the next
 * few reminders with "See all" and an activity picker to add more. Bulk
 * switches come first so a long reminder list never pushes them out of
 * reach. Rendered inside the caller's ScrollView.
 */
export function ScheduleReminderSections({
  reminders,
}: {
  reminders: ReturnType<typeof useScheduleReminders>;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const timeColumnWidth = useTimeColumnWidth();
  const { items, kinds, notifications, loading, error, reload } = reminders;

  const now = Date.now();
  const ready = notifications.ready && items.length > 0;
  const upcomingReminders = ready
    ? items.filter((item) => isUpcoming(item, now) && notifications.isEntrySubscribed(item))
    : [];
  const previewReminders = upcomingReminders.slice(0, UPCOMING_PREVIEW_LIMIT);

  if (!ready) {
    if (error && !loading) return <RequestFeedback error={error} onRetry={() => void reload()} />;
    if (loading || !notifications.ready) return <RequestFeedback loading />;
    return null;
  }

  return (
    <>
      {notifications.error ? (
        <RequestFeedback
          error={notifications.error}
          message={t("scheduleReminderError")}
          onRetry={notifications.retry}
          retrying={notifications.savingKey !== null}
        />
      ) : null}

      {kinds.length > 0 ? (
        <Section title={t("alertsByKind")}>
          {kinds.map((kind, index) => {
            const kindItems = items.filter((item) => item.type === kind);
            const notifiedCount = kindItems.filter(notifications.isEntrySubscribed).length;
            return (
              <View key={kind}>
                {index > 0 ? <Separator /> : null}
                <ToggleRow
                  label={scheduleTypeLabel(kind, t)}
                  detail={t("alertsKindCount", {
                    count: String(notifiedCount),
                    total: String(kindItems.length),
                  })}
                  busy={notifications.savingKey === kindCategory(kind)}
                  value={notifications.categoryState(kind) !== "off"}
                  onChange={(next) => void notifications.toggleCategory(kind, next)}
                  onPress={() =>
                    router.push({ pathname: "/(tabs)/others/reminders/[kind]", params: { kind } })
                  }
                />
              </View>
            );
          })}
        </Section>
      ) : null}

      <Section title={t("alertsUpcoming")} footer={t("scheduleNotificationsSubtitle")}>
        {previewReminders.map((item, index) => (
          <View key={item.id}>
            {index > 0 ? <Separator inset={rowSeparatorInset(timeColumnWidth)} /> : null}
            <ReminderRow
              item={item}
              showDay
              subscribed
              timeColumnWidth={timeColumnWidth}
              busy={notifications.savingKey === itemCategory(item.id)}
              onToggle={() => void notifications.toggleEntry(item)}
            />
          </View>
        ))}
        {upcomingReminders.length > UPCOMING_PREVIEW_LIMIT ? (
          <>
            <Separator />
            <Pressable
              accessibilityLabel={`${t("alertsSeeAll")}, ${upcomingReminders.length}`}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/others/reminders/[kind]",
                  params: { kind: "all", subscribed: "1" },
                })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <InfoRow
                accessoryIcon="chevron.right"
                label={t("alertsSeeAll")}
                value={String(upcomingReminders.length)}
              />
            </Pressable>
          </>
        ) : null}
        {previewReminders.length > 0 ? <Separator /> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/(tabs)/others/reminders/[kind]",
              params: { kind: "all" },
            })
          }
          style={({ pressed }) => ({
            alignItems: "center",
            flexDirection: "row",
            gap: 12,
            minHeight: 50,
            opacity: pressed ? 0.6 : 1,
            paddingHorizontal: 16,
          })}
        >
          <SymbolView
            name="plus.circle.fill"
            tintColor={colors.accent}
            size={22}
            accessible={false}
          />
          <Text style={{ color: colors.accent, flex: 1, fontSize: 16 }}>
            {t("notificationsAddActivityReminder")}
          </Text>
        </Pressable>
      </Section>
    </>
  );
}

/**
 * H59: every activity of one kind (or every upcoming activity for `all`),
 * grouped by day, each with its own reminder toggle — how a person adds a
 * reminder from Alerts without hunting for the card in the schedule.
 * `subscribedOnly` is the full "Coming up" list: the upcoming activities the
 * person is reminded about. A row switched off there stays until the person
 * leaves, so a mistaken tap can be undone in place.
 */
export function ReminderPickerScreen({
  kind,
  subscribedOnly = false,
}: {
  kind: string;
  subscribedOnly?: boolean;
}) {
  const { t, language } = useLocale();
  const { items, notifications, loading, error, staleSince, reload } = useScheduleReminders();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const timeColumnWidth = useTimeColumnWidth();
  const shownSubscribed = useRef(new Set<number>());
  const now = Date.now();
  const visible = items.filter((item) => {
    if (kind === "all" ? !isUpcoming(item, now) : item.type !== kind) return false;
    if (!subscribedOnly || !notifications.ready) return true;
    if (notifications.isEntrySubscribed(item)) shownSubscribed.current.add(item.id);
    return shownSubscribed.current.has(item.id);
  });
  const eventZone = useEventTimeZone();
  const days = useMemo(() => {
    const groups = new Map<string, ScheduleItem[]>();
    for (const item of visible) {
      const key = eventDayKey(item.startsAt, eventZone);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()].map(([key, dayItems]) => ({
      key,
      title: formatEventTime(
        dayItems[0].startsAt,
        language,
        { weekday: "long", month: "long", day: "numeric" },
        eventZone,
      ),
      items: dayItems,
    }));
  }, [visible, language, eventZone]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 20,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
    >
      <StaleDataBanner updatedAt={staleSince} />
      {notifications.error ? (
        <RequestFeedback
          error={notifications.error}
          message={t("scheduleReminderError")}
          onRetry={notifications.retry}
          retrying={notifications.savingKey !== null}
        />
      ) : null}
      {!notifications.ready || (items.length === 0 && (loading || error)) ? (
        <RequestFeedback
          loading={loading || !notifications.ready}
          error={error}
          onRetry={() => void reload()}
        />
      ) : days.length === 0 ? (
        <EmptyState
          icon={subscribedOnly ? "bell.slash" : "calendar.badge.clock"}
          title={t(
            subscribedOnly ? "notificationsNoActiveReminders" : "notificationsNoUpcomingActivities",
          )}
        />
      ) : (
        days.map((day) => (
          <Section key={day.key} title={day.title}>
            {day.items.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <Separator inset={rowSeparatorInset(timeColumnWidth)} /> : null}
                <ReminderRow
                  item={item}
                  subscribed={notifications.isEntrySubscribed(item)}
                  timeColumnWidth={timeColumnWidth}
                  busy={notifications.savingKey === itemCategory(item.id)}
                  onToggle={() => void notifications.toggleEntry(item)}
                />
              </View>
            ))}
          </Section>
        ))
      )}
    </ScrollView>
  );
}

function ReminderRow({
  item,
  subscribed,
  busy,
  showDay = false,
  timeColumnWidth,
  onToggle,
}: {
  item: ScheduleItem;
  subscribed: boolean;
  busy: boolean;
  showDay?: boolean;
  timeColumnWidth: number;
  onToggle: () => void;
}) {
  const { t, language } = useLocale();
  const router = useRouter();
  const startsAt = new Date(item.startsAt);
  useEventTimeZone();
  const time = formatEventTime(startsAt, language, { hour: "2-digit", minute: "2-digit" });
  const day = formatEventTime(startsAt, language, { weekday: "short" });
  const meta = [item.type ? scheduleTypeLabel(item.type, t) : null, item.location]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 58,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[item.title, showDay ? day : null, time].filter(Boolean).join(", ")}
        onPress={() => router.push({ pathname: "/schedule/[id]", params: { id: String(item.id) } })}
        style={({ pressed }) => ({
          alignItems: "center",
          flex: 1,
          flexDirection: "row",
          gap: 12,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <View style={{ width: timeColumnWidth }}>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={1}
            style={{
              color: subscribed ? colors.accent : colors.label,
              fontSize: 15,
              fontVariant: ["tabular-nums"],
              fontWeight: "600",
            }}
          >
            {time}
          </Text>
          {showDay ? (
            <Text
              numberOfLines={1}
              style={{
                color: colors.secondaryLabel,
                fontSize: 12,
                textTransform: "capitalize",
              }}
            >
              {day}
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: colors.label, fontSize: 16 }}>
            {item.title}
          </Text>
          {meta ? (
            <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 13 }}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <AppSwitch
        accessibilityLabel={
          subscribed
            ? t("scheduleReminderOn", { name: item.title })
            : t("scheduleReminderOff", { name: item.title })
        }
        disabled={busy}
        onValueChange={onToggle}
        style={SWITCH_IN_ROW_STYLE}
        value={subscribed}
      />
    </View>
  );
}
