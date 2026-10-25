import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import {
  AppSwitch,
  EmptyState,
  Section,
  Separator,
  SWITCH_IN_ROW_STYLE,
  ToggleRow,
} from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
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
import { matchesQuery, useHeaderSearch } from "@/lib/use-header-search";
import {
  itemCategory,
  kindCategory,
  useScheduleNotifications,
} from "@/lib/use-schedule-notifications";
import { useStreamRefresh } from "@/lib/use-stream-refresh";
import { colors, type } from "@/theme";

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
      ].sort((a, b) => a.localeCompare(b, language)),
    [items, language],
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

/**
 * H59: the reminder part of Account → Notifications → Activity reminders,
 * below the channel switches: a bulk switch per activity type. A search query
 * replaces them with the matching activities, each with its own reminder
 * switch. Rendered inside the caller's ScrollView.
 */
export function ScheduleReminderSections({
  reminders,
  query = "",
}: {
  reminders: ReturnType<typeof useScheduleReminders>;
  query?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const timeColumnWidth = useTimeColumnWidth();
  const { items, kinds, notifications, loading, error, reload } = reminders;

  const ready = notifications.ready && items.length > 0;
  const searching = query.trim().length > 0;

  if (!ready) {
    if (error && !loading) return <RequestFeedback error={error} onRetry={() => void reload()} />;
    if (loading || !notifications.ready) return <RequestFeedback loading />;
    return null;
  }

  const matches = searching
    ? items.filter((item) =>
        matchesQuery(
          query,
          item.title,
          item.location,
          item.type ? scheduleTypeLabel(item.type, t) : null,
        ),
      )
    : [];

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

      {searching ? (
        matches.length === 0 ? (
          <EmptyState icon="magnifyingglass" title={t("scannerNoResults")} />
        ) : (
          <Section>
            {matches.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <Separator inset={rowSeparatorInset(timeColumnWidth)} /> : null}
                <ReminderRow
                  item={item}
                  showDay
                  subscribed={notifications.isEntrySubscribed(item)}
                  timeColumnWidth={timeColumnWidth}
                  busy={notifications.savingKey === itemCategory(item.id)}
                  onToggle={() => void notifications.toggleEntry(item)}
                />
              </View>
            ))}
          </Section>
        )
      ) : kinds.length > 0 ? (
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
    </>
  );
}

/**
 * H59: every activity of one kind grouped by day, each with its own reminder
 * toggle, searchable from the header.
 */
export function ReminderPickerScreen({ kind }: { kind: string }) {
  const { t, language } = useLocale();
  const { items, notifications, loading, error, staleSince, reload } = useScheduleReminders();
  const query = useHeaderSearch(t("scheduleSearchPlaceholder"));
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const timeColumnWidth = useTimeColumnWidth();
  const visible = items.filter(
    (item) => item.type === kind && matchesQuery(query, item.title, item.location),
  );
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
      keyboardDismissMode="on-drag"
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
        <EmptyState icon="magnifyingglass" title={t("scannerNoResults")} />
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
      <PressableFeedback
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={[item.title, showDay ? day : null, time].filter(Boolean).join(", ")}
        onPress={() => router.push({ pathname: "/schedule/[id]", params: { id: String(item.id) } })}
        style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 12 }}
      >
        <View style={{ width: timeColumnWidth }}>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={1}
            style={{
              color: subscribed ? colors.accent : colors.label,
              fontSize: type.subhead.fontSize,
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
                fontSize: type.caption.fontSize,
                textTransform: "capitalize",
              }}
            >
              {day}
            </Text>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={2} style={{ color: colors.label, fontSize: type.callout.fontSize }}>
            {item.title}
          </Text>
          {meta ? (
            <Text
              numberOfLines={1}
              style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}
            >
              {meta}
            </Text>
          ) : null}
        </View>
      </PressableFeedback>
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
