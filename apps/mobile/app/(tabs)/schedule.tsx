import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, SectionList, Text, useColorScheme, View } from "react-native";

import { EmptyState, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

interface ScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string;
}

interface ScheduleSection {
  key: string;
  title: string;
  data: ScheduleItem[];
}

/** Participant schedule backed by the same public read model used on web. */
export default function ScheduleScreen() {
  useColorScheme();
  const { t, language } = useLocale();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { items: rows } = await apiFetch<{ items: ScheduleItem[] }>("/api/public/activities");
      setItems(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Failed to load schedule"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo<ScheduleSection[]>(() => {
    const grouped = new Map<string, ScheduleItem[]>();
    for (const item of [...items].sort(
      (a, b) => safeTimestamp(a.startsAt) - safeTimestamp(b.startsAt),
    )) {
      const key = new Date(item.startsAt).toLocaleDateString("en-CA");
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].map(([key, data]) => ({
      key,
      data,
      title: new Date(data[0].startsAt).toLocaleDateString(language, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    }));
  }, [items, language]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item) => String(item.id)}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      stickySectionHeadersEnabled={false}
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
      renderItem={({ item, index, section }) => (
        <ScheduleCard item={item} language={language} last={index === section.data.length - 1} />
      )}
    />
  );
}

function safeTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function ScheduleCard({
  item,
  language,
  last,
}: {
  item: ScheduleItem;
  language: string;
  last: boolean;
}) {
  const startsAt = new Date(item.startsAt);
  const endsAt = new Date(item.endsAt);
  const time = startsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
  const end = endsAt.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={{ flexDirection: "row", paddingHorizontal: 16 }}>
      <View style={{ alignItems: "center", width: 62 }}>
        <Text
          selectable
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
      <View
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
            style={{ color: colors.label, flex: 1, fontSize: 17, fontWeight: "700" }}
          >
            {item.title}
          </Text>
          {item.type ? <StatusPill>{item.type}</StatusPill> : null}
        </View>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
          <SymbolView name="clock" tintColor={colors.secondaryLabel} size={14} accessible={false} />
          <Text
            selectable
            style={{ color: colors.secondaryLabel, fontSize: 14, fontVariant: ["tabular-nums"] }}
          >
            {time}–{end}
          </Text>
        </View>
        {item.location ? (
          <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
            <SymbolView
              name="mappin.and.ellipse"
              tintColor={colors.secondaryLabel}
              size={14}
              accessible={false}
            />
            <Text selectable style={{ color: colors.secondaryLabel, flex: 1, fontSize: 14 }}>
              {item.location}
            </Text>
          </View>
        ) : null}
        {item.description ? (
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21 }}>
            {item.description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
