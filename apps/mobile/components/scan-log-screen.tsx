import { useNavigation } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ActionButton, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { fetchScanLog, type ScanLogEntry } from "@/lib/scan-log";
import { colors } from "@/theme/colors";

const PAGE_SIZE = 30;

const SOURCE_ICON: Record<ScanLogEntry["source"], SymbolViewProps["name"]> = {
  accreditation: "person.badge.key.fill",
  door: "door.left.hand.open",
  activity: "list.bullet.rectangle",
};

function dayKey(iso: string): string {
  return typeof iso === "string" ? iso.slice(0, 10) : "";
}

function dayHeading(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "today";
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return "yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

export function ScanLogScreen() {
  const navigation = useNavigation();
  const { t } = useLocale();
  const [items, setItems] = useState<ScanLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    navigation.setOptions({
      title: t("scanLogTitle"),
      headerShown: true,
      headerLargeTitle: true,
      headerBackButtonDisplayMode: "minimal",
    });
  }, [navigation, t]);

  const load = useCallback(async (offset: number) => {
    const page = await fetchScanLog(PAGE_SIZE, offset);
    setTotal(page.total);
    setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await load(0);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load scan log"));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function loadMore() {
    if (loadingMore || items.length >= total) return;
    setLoadingMore(true);
    try {
      await load(items.length);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load scan log"));
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <RequestFeedback loading />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <RequestFeedback error={error} onRetry={() => void reload()} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View
        style={{ alignItems: "center", flex: 1, gap: 10, justifyContent: "center", padding: 32 }}
      >
        <SymbolView name="clock.arrow.circlepath" size={36} tintColor={colors.tertiaryLabel} />
        <Text style={{ color: colors.secondaryLabel, fontSize: 15, textAlign: "center" }}>
          {t("scanLogEmpty")}
        </Text>
      </View>
    );
  }

  const groups: { heading: string; entries: ScanLogEntry[] }[] = [];
  for (const entry of items) {
    const heading = dayHeading(entry.occurredAt);
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.entries.push(entry);
    else groups.push({ heading, entries: [entry] });
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 20, padding: 16, paddingBottom: 36 }}
    >
      {groups.map((group) => (
        <Section
          key={group.heading}
          title={
            group.heading === "today"
              ? t("scanLogToday")
              : group.heading === "yesterday"
                ? t("scanLogYesterday")
                : group.heading
          }
        >
          {group.entries.map((entry, index) => (
            <View key={`${entry.source}-${entry.id}`}>
              <ScanLogRow entry={entry} />
              {index < group.entries.length - 1 ? <Separator inset={48} /> : null}
            </View>
          ))}
        </Section>
      ))}
      {items.length < total ? (
        <ActionButton
          label={t("scanLogLoadMore")}
          icon="arrow.down.circle"
          busy={loadingMore}
          onPress={() => void loadMore()}
        />
      ) : null}
    </ScrollView>
  );
}

function ScanLogRow({ entry }: { entry: ScanLogEntry }) {
  const { t } = useLocale();
  const subject = [entry.subjectName, entry.subjectSurname].filter(Boolean).join(" ");
  const sourceLabel =
    entry.source === "accreditation"
      ? t("scannerAccreditation")
      : entry.source === "door"
        ? t("scannerPresence")
        : t("scannerActivity");
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      <SymbolView
        accessible={false}
        name={SOURCE_ICON[entry.source]}
        size={19}
        tintColor={colors.accent}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          selectable
          numberOfLines={1}
          style={{ color: colors.label, fontSize: 15, fontWeight: "700" }}
        >
          {subject}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 13 }}>
          {sourceLabel}
          {entry.detail ? ` · ${entry.detail}` : ""}
        </Text>
      </View>
      <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>
        {new Date(entry.occurredAt).toLocaleTimeString()}
      </Text>
    </View>
  );
}
