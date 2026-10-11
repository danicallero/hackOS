import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { EmptyState, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
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
import { colors } from "@/theme/colors";

/** Reminder rows reserve this leading column for the start time. */
const TIME_COLUMN_WIDTH = 56;
const ROW_SEPARATOR_INSET = 16 + TIME_COLUMN_WIDTH + 12;

/**
 * H59: the schedule plus the person's reminder preferences, sharing the
 * Schedule tab's cache so both surfaces show the same activities and every
 * toggle propagates through the preference-change channel.
 */
export function useScheduleReminders() {
  const { language } = useLocale();
  const { data, loading, error, staleSince, load } = useCachedApi("schedule", fetchPublicSchedule);
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
 * H59: the reminder part of Account → Notifications → Activity reminders:
 * what the person will be notified about, a picker to add more, and a bulk
 * switch per activity type. Rendered inside the caller's ScrollView.
 */
export function ScheduleReminderSections({
  reminders,
}: {
  reminders: ReturnType<typeof useScheduleReminders>;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { items, kinds, notifications, loading, error, reload } = reminders;

  const now = Date.now();
  const ready = notifications.ready && items.length > 0;
  const upcomingReminders = ready
    ? items.filter((item) => isUpcoming(item, now) && notifications.isEntrySubscribed(item))
    : [];

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
      <Section title={t("alertsUpcoming")} footer={t("scheduleNotificationsSubtitle")}>
        {upcomingReminders.length === 0 ? (
          <View style={{ alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 20 }}>
            <SymbolView
              name="bell.slash"
              tintColor={colors.tertiaryLabel}
              size={26}
              accessible={false}
            />
            <Text
              selectable
              style={{ color: colors.secondaryLabel, fontSize: 15, textAlign: "center" }}
            >
              {t("notificationsNoActiveReminders")}
            </Text>
          </View>
        ) : (
          upcomingReminders.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Separator inset={ROW_SEPARATOR_INSET} /> : null}
              <ReminderRow
                item={item}
                showDay
                subscribed
                busy={notifications.savingKey === itemCategory(item.id)}
                onToggle={() => void notifications.toggleEntry(item)}
              />
            </View>
          ))
        )}
        {upcomingReminders.length > 0 ? <Separator /> : null}
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
          <Text style={{ color: colors.accent, flex: 1, fontSize: 16, fontWeight: "500" }}>
            {t("notificationsAddActivityReminder")}
          </Text>
        </Pressable>
      </Section>

      {kinds.length > 0 ? (
        <Section title={t("alertsByKind")}>
          {kinds.map((kind, index) => {
            const kindItems = items.filter((item) => item.type === kind);
            const notifiedCount = kindItems.filter(notifications.isEntrySubscribed).length;
            const label = scheduleTypeLabel(kind, t);
            return (
              <View key={kind}>
                {index > 0 ? <Separator /> : null}
                <View
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: 10,
                    minHeight: 56,
                    paddingLeft: 16,
                    paddingRight: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/others/reminders/[kind]",
                        params: { kind },
                      })
                    }
                    style={({ pressed }) => ({ flex: 1, gap: 2, opacity: pressed ? 0.6 : 1 })}
                  >
                    <Text style={{ color: colors.label, fontSize: 16 }}>{label}</Text>
                    <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                      {t("alertsKindCount", {
                        count: String(notifiedCount),
                        total: String(kindItems.length),
                      })}
                    </Text>
                  </Pressable>
                  <Switch
                    accessibilityLabel={label}
                    disabled={notifications.savingKey === kindCategory(kind)}
                    onValueChange={(next) => void notifications.toggleCategory(kind, next)}
                    value={notifications.categoryState(kind) !== "off"}
                  />
                  <SymbolView
                    name="chevron.right"
                    tintColor={colors.tertiaryLabel}
                    size={13}
                    weight="semibold"
                    accessible={false}
                  />
                </View>
              </View>
            );
          })}
        </Section>
      ) : null}
    </>
  );
}

/**
 * H59: every activity of one kind (or every upcoming activity for `all`),
 * grouped by day, each with its own reminder toggle — how a person adds a
 * reminder from Alerts without hunting for the card in the schedule.
 */
export function ReminderPickerScreen({ kind }: { kind: string }) {
  const { t, language } = useLocale();
  const { items, notifications, loading, error, staleSince, reload } = useScheduleReminders();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const now = Date.now();
  const visible = items.filter((item) =>
    kind === "all" ? isUpcoming(item, now) : item.type === kind,
  );
  const days = useMemo(() => {
    const groups = new Map<string, ScheduleItem[]>();
    for (const item of visible) {
      const key = new Date(item.startsAt).toLocaleDateString("en-CA");
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()].map(([key, dayItems]) => ({
      key,
      title: new Date(dayItems[0].startsAt).toLocaleDateString(language, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
      items: dayItems,
    }));
  }, [visible, language]);

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
        <EmptyState icon="calendar.badge.clock" title={t("notificationsNoUpcomingActivities")} />
      ) : (
        days.map((day) => (
          <Section key={day.key} title={day.title}>
            {day.items.map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <Separator inset={ROW_SEPARATOR_INSET} /> : null}
                <ReminderRow
                  item={item}
                  subscribed={notifications.isEntrySubscribed(item)}
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
  onToggle,
}: {
  item: ScheduleItem;
  subscribed: boolean;
  busy: boolean;
  showDay?: boolean;
  onToggle: () => void;
}) {
  const { t, language } = useLocale();
  const router = useRouter();
  const startsAt = new Date(item.startsAt);
  const time = startsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const day = startsAt.toLocaleDateString(language, { weekday: "short" });
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
        <View style={{ width: TIME_COLUMN_WIDTH }}>
          <Text
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
      <Switch
        accessibilityLabel={
          subscribed
            ? t("scheduleReminderOn", { name: item.title })
            : t("scheduleReminderOff", { name: item.title })
        }
        disabled={busy}
        onValueChange={onToggle}
        value={subscribed}
      />
    </View>
  );
}
