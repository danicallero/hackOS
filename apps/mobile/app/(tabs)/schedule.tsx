import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  type TextLayoutEventData,
  useColorScheme,
  View,
} from "react-native";

import { EmptyState, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { useLocale } from "@/lib/i18n";
import { fetchPublicSchedule, type ScheduleItem } from "@/lib/schedule";
import { useActivityReminders } from "@/lib/use-activity-reminders";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

type NowMarker = { kind: "now"; id: string };
type SectionRow = (ScheduleItem & { kind: "item" }) | NowMarker;

interface ScheduleSection {
  key: string;
  title: string;
  data: SectionRow[];
}

/** Participant schedule backed by the same public read model used on web. */
export default function ScheduleScreen() {
  useColorScheme();
  const { t, language } = useLocale();
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<SectionList<SectionRow, ScheduleSection>>(null);
  const scrolledOnLoad = useRef(false);
  const reminders = useActivityReminders();

  const { data, loading, error, staleSince, load } = useCachedApi("schedule", fetchPublicSchedule);
  const items = data ?? [];

  useEffect(() => {
    void load();
    void reminders.load();
  }, [load, reminders.load]);

  // Keeps the "now" line accurate without a full data reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const todayKey = useMemo(() => new Date(now).toLocaleDateString("en-CA"), [now]);

  const sections = useMemo<ScheduleSection[]>(() => {
    const grouped = new Map<string, ScheduleItem[]>();
    for (const item of [...items].sort(
      (a, b) => safeTimestamp(a.startsAt) - safeTimestamp(b.startsAt),
    )) {
      const key = new Date(item.startsAt).toLocaleDateString("en-CA");
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].map(([key, dayItems]) => {
      const rows: SectionRow[] = dayItems.map((item) => ({ ...item, kind: "item" as const }));
      if (key === todayKey) {
        const hasActiveItem = dayItems.some(
          (item) => safeTimestamp(item.startsAt) <= now && safeTimestamp(item.endsAt) >= now,
        );
        if (!hasActiveItem) {
          const markerIndex = dayItems.findIndex((item) => safeTimestamp(item.startsAt) > now);
          const insertAt = markerIndex === -1 ? rows.length : markerIndex;
          rows.splice(insertAt, 0, { kind: "now", id: "now-marker" });
        }
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
  }, [items, language, now, todayKey]);

  // Jumps straight to "what's happening now" (or the marker between cards)
  // instead of opening at the beginning of a multi-day schedule.
  useEffect(() => {
    if (scrolledOnLoad.current || sections.length === 0) return;
    scrolledOnLoad.current = true;
    const sectionIndex = sections.findIndex((section) => section.key === todayKey);
    if (sectionIndex === -1) return;
    let itemIndex = sections[sectionIndex].data.findIndex((row) => row.kind === "now");
    if (itemIndex === -1) {
      itemIndex = sections[sectionIndex].data.findIndex(
        (row) =>
          row.kind === "item" &&
          safeTimestamp(row.startsAt) <= now &&
          safeTimestamp(row.endsAt) >= now,
      );
    }
    if (itemIndex === -1) return;
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToLocation({
          sectionIndex,
          itemIndex,
          viewOffset: 80,
          animated: false,
        });
      } catch {
        // Best-effort — a transient layout mismatch just means no auto-scroll this time.
      }
    });
  }, [now, sections, todayKey]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SectionList
      ref={listRef}
      sections={sections}
      keyExtractor={(row) => (row.kind === "now" ? row.id : String(row.id))}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      stickySectionHeadersEnabled={false}
      onScrollToIndexFailed={() => {
        // Rows above collapse/expand height changes; a silent retry-free
        // failure is better than a crash — the user can just scroll manually.
      }}
      ListHeaderComponent={<StaleDataBanner updatedAt={staleSince} />}
      ListHeaderComponentStyle={{ paddingHorizontal: 16, paddingTop: staleSince ? 16 : 0 }}
      ListEmptyComponent={
        loading ? (
          <RequestFeedback loading />
        ) : error ? (
          <RequestFeedback error={error} onRetry={() => void load()} />
        ) : (
          <EmptyState
            icon="calendar.badge.clock"
            title={t("scheduleEmptyTitle")}
            description={t("scheduleEmpty")}
          />
        )
      }
      renderSectionHeader={({ section }) => (
        <Text
          selectable
          style={{
            color: colors.label,
            fontSize: 22,
            fontWeight: "700",
            paddingBottom: 10,
            paddingHorizontal: 16,
            paddingTop: 22,
            textTransform: "capitalize",
          }}
        >
          {section.title}
        </Text>
      )}
      renderItem={({ item, index, section }) =>
        item.kind === "now" ? (
          <NowMarkerRow now={now} />
        ) : (
          <ScheduleCard
            item={item}
            language={language}
            last={index === section.data.length - 1}
            reminderOn={reminders.ready ? reminders.isEnabled(item.id) : null}
            reminderBusy={reminders.savingId === item.id}
            onToggleReminder={(enabled) => void reminders.toggle(item.id, enabled)}
          />
        )
      }
    />
  );
}

function safeTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function NowMarkerRow({ now }: { now: number }) {
  const { t, language } = useLocale();
  const label = new Date(now).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <NowMarkerLine accessibilityLabel={t("scheduleNow", { time: label })} label={label} />
    </View>
  );
}

function NowMarkerLine({
  accessibilityLabel,
  label,
}: {
  accessibilityLabel: string;
  label: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      pointerEvents="none"
      style={{ alignItems: "center", flexDirection: "row" }}
    >
      <View style={{ alignItems: "center", width: 70 }}>
        <Text
          selectable
          numberOfLines={1}
          style={{
            color: colors.destructive,
            fontSize: 12,
            fontVariant: ["tabular-nums"],
            fontWeight: "700",
          }}
        >
          {label}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: colors.destructive,
          borderRadius: 999,
          height: 7,
          marginLeft: 4,
          width: 7,
        }}
      />
      <View style={{ backgroundColor: colors.destructive, flex: 1, height: 1.5, marginLeft: 6 }} />
    </View>
  );
}

function ScheduleCard({
  item,
  language,
  last,
  reminderOn,
  reminderBusy,
  onToggleReminder,
}: {
  item: ScheduleItem;
  language: string;
  last: boolean;
  reminderOn: boolean | null;
  reminderBusy: boolean;
  onToggleReminder: (enabled: boolean) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const startsAt = new Date(item.startsAt);
  const endsAt = new Date(item.endsAt);
  const time = startsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const end = endsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const [truncated, setTruncated] = useState(false);

  function toggleReminder(event: GestureResponderEvent) {
    event.stopPropagation();
    onToggleReminder(!reminderOn);
  }

  // Cards stay compact with a fixed line count per field; this flags when any
  // field actually got clipped so we can hint that the full text is one tap away.
  function noteIfClipped(maxLines: number) {
    return (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (event.nativeEvent.lines.length >= maxLines) setTruncated(true);
    };
  }

  return (
    <View style={{ flexDirection: "row", paddingHorizontal: 16 }}>
      <View style={{ alignItems: "center", width: 70 }}>
        <Text
          selectable
          numberOfLines={1}
          style={{
            color: colors.label,
            fontSize: 15,
            fontVariant: ["tabular-nums"],
            fontWeight: "600",
          }}
        >
          {time}
        </Text>
        {!last ? (
          <View style={{ backgroundColor: colors.separator, flex: 1, marginTop: 8, width: 1 }} />
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={item.title}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: "/schedule/[id]", params: { id: String(item.id) } })}
        style={{
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: 14,
          flex: 1,
          gap: 9,
          marginBottom: 12,
          marginLeft: 8,
          padding: 16,
        }}
      >
        <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 8 }}>
          <Text
            selectable
            numberOfLines={1}
            onTextLayout={noteIfClipped(1)}
            style={{ color: colors.label, flex: 1, fontSize: 17, fontWeight: "700" }}
          >
            {item.title}
          </Text>
          {item.type ? <StatusPill>{item.type}</StatusPill> : null}
          {reminderOn !== null ? (
            <Pressable
              accessibilityLabel={t(reminderOn ? "scheduleReminderOn" : "scheduleReminderOff", {
                name: item.title,
              })}
              accessibilityRole="button"
              accessibilityState={{ selected: reminderOn, busy: reminderBusy }}
              disabled={reminderBusy}
              hitSlop={8}
              onPress={toggleReminder}
              style={{ opacity: reminderBusy ? 0.4 : 1 }}
            >
              <SymbolView
                name={reminderOn ? "bell.fill" : "bell"}
                tintColor={reminderOn ? colors.accent : colors.tertiaryLabel}
                size={19}
              />
            </Pressable>
          ) : null}
        </View>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
          <SymbolView name="clock" tintColor={colors.secondaryLabel} size={14} accessible={false} />
          <Text
            selectable
            style={{ color: colors.secondaryLabel, fontSize: 14, fontVariant: ["tabular-nums"] }}
          >
            {time}–{end}
          </Text>
          {item.location ? (
            <>
              <Text style={{ color: colors.tertiaryLabel, fontSize: 14 }}>·</Text>
              <SymbolView
                name="mappin.and.ellipse"
                tintColor={colors.secondaryLabel}
                size={14}
                accessible={false}
              />
              <Text
                selectable
                numberOfLines={1}
                onTextLayout={noteIfClipped(1)}
                style={{ color: colors.secondaryLabel, flex: 1, fontSize: 14 }}
              >
                {item.location}
              </Text>
            </>
          ) : null}
        </View>
        {item.description ? (
          <Text
            selectable
            numberOfLines={2}
            onTextLayout={noteIfClipped(2)}
            style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21 }}
          >
            {item.description}
          </Text>
        ) : null}
        {truncated ? (
          <View
            accessible={false}
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 3,
              justifyContent: "flex-end",
            }}
          >
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "600" }}>
              {t("scheduleShowMore")}
            </Text>
            <SymbolView
              name="chevron.right"
              tintColor={colors.accent}
              size={11}
              accessible={false}
            />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
