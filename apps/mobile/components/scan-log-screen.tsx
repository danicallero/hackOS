import {
  type Href,
  useLocalSearchParams,
  useNavigation,
  usePathname,
  useRouter,
  useScrollToTop,
} from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { ActionButton, Section, Separator } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { safeBack } from "@/lib/navigation";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
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
  const { from } = useLocalSearchParams<{ from?: string }>();
  const navigation = useNavigation();
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ScanLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);

  useScrollToTop(scrollRef);

  const origin = Array.isArray(from) ? from[0] : from;
  const fallbackRoute: Href =
    origin === "statistics"
      ? "/(tabs)/others/statistics"
      : origin === "scanner" || pathname.includes("/scan/")
        ? "/(tabs)/scan"
        : "/(tabs)/others/account";

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("scanLogTitle"),
      headerShown: true,
      headerLargeTitle: true,
      headerBackButtonDisplayMode: "minimal",
      // The history can also be opened from a notification or a restored
      // deep link. Keep the native navigation bar, but make its back action
      // safe when there is no stack entry to pop.
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable
          accessibilityLabel={t("back")}
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => safeBack(router, fallbackRoute)}
          style={{ alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 }}
        >
          <SymbolView
            accessible={false}
            name="chevron.left"
            size={22}
            tintColor={colors.accent}
            weight="semibold"
          />
        </Pressable>
      ),
      headerSearchBarOptions: {
        placeholder: t("scanLogSearchPlaceholder"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: false,
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [fallbackRoute, navigation, router, t]);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Failed to load scan history"));
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
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Failed to load scan history"));
    } finally {
      setLoadingMore(false);
    }
  }

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((entry) => searchableEntryText(entry, t).includes(needle));
  }, [items, query, t]);

  function openEntry(entry: ScanLogEntry) {
    const params = { id: String(entry.subjectUserId) };
    if (entry.source === "accreditation") {
      if (pathname.includes("/scan/")) {
        router.push({ pathname: "/(tabs)/scan/person/[id]", params });
      } else {
        router.push({ pathname: "/(tabs)/others/person/[id]", params });
      }
      return;
    }
    const focusParams = {
      ...params,
      focusLogId: String(entry.id),
      focusSource: entry.source,
    };
    if (pathname.includes("/scan/")) {
      router.push({ pathname: "/(tabs)/scan/person/[id]", params: focusParams });
    } else {
      router.push({ pathname: "/(tabs)/others/person/[id]", params: focusParams });
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
        <SymbolView
          accessible={false}
          name="clock.arrow.circlepath"
          size={36}
          tintColor={colors.tertiaryLabel}
        />
        <Text style={{ color: colors.secondaryLabel, fontSize: 15, textAlign: "center" }}>
          {t("scanLogEmpty")}
        </Text>
      </View>
    );
  }

  const groups: { heading: string; entries: ScanLogEntry[] }[] = [];
  for (const entry of filteredItems) {
    const heading = dayHeading(entry.occurredAt);
    const last = groups[groups.length - 1];
    if (last?.heading === heading) last.entries.push(entry);
    else groups.push({ heading, entries: [entry] });
  }

  return (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 20,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
    >
      <Text
        style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21, paddingHorizontal: 4 }}
      >
        {t("scanLogDescription")}
      </Text>
      {filteredItems.length === 0 ? (
        <View style={{ alignItems: "center", gap: 8, paddingHorizontal: 24, paddingVertical: 36 }}>
          <SymbolView
            accessible={false}
            name="magnifyingglass"
            size={28}
            tintColor={colors.tertiaryLabel}
          />
          <Text
            accessibilityRole="header"
            style={{ color: colors.label, fontSize: 19, fontWeight: "700", textAlign: "center" }}
          >
            {t("scanLogNoMatches")}
          </Text>
          <Text
            style={{
              color: colors.secondaryLabel,
              fontSize: 14,
              lineHeight: 20,
              textAlign: "center",
            }}
          >
            {t("scanLogNoMatchesDescription")}
          </Text>
        </View>
      ) : null}
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
              <ScanLogRow entry={entry} onPress={() => openEntry(entry)} />
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

function searchableEntryText(entry: ScanLogEntry, t: ReturnType<typeof useLocale>["t"]): string {
  const subject = [entry.subjectName, entry.subjectSurname].filter(Boolean).join(" ");
  const sourceLabel =
    entry.source === "accreditation"
      ? t("scannerAccreditation")
      : entry.source === "door"
        ? t("scannerPresence")
        : t("scannerActivity");
  return [
    subject,
    entry.subjectUserId,
    sourceLabel,
    contextLabel(entry, t),
    methodLabel(entry, t),
    entry.detail,
    entry.activityName,
    entry.activityCategory,
    entry.doorKind,
    entry.doorLocation,
    entry.badgeId,
    entry.notes,
    entry.occurredAt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function ScanLogRow({ entry, onPress }: { entry: ScanLogEntry; onPress: () => void }) {
  const { t } = useLocale();
  const subject =
    [entry.subjectName, entry.subjectSurname].filter(Boolean).join(" ") ||
    t("scanLogUnknownPerson", { id: String(entry.subjectUserId) });
  const sourceLabel =
    entry.source === "accreditation"
      ? t("scannerAccreditation")
      : entry.source === "door"
        ? t("scannerPresence")
        : t("scannerActivity");
  const context = contextLabel(entry, t);
  const method = methodLabel(entry, t);

  return (
    <Pressable
      accessibilityHint={t("scanLogOpenProfile")}
      accessibilityLabel={`${subject}, ${sourceLabel}, ${context}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.elevatedSurface : colors.transparent,
        gap: 7,
        paddingHorizontal: 16,
        paddingVertical: 14,
      })}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
        <SymbolView
          accessible={false}
          name={SOURCE_ICON[entry.source]}
          size={20}
          tintColor={colors.accent}
        />
        <Text
          selectable
          numberOfLines={1}
          style={{ color: colors.label, flex: 1, fontSize: 16, fontWeight: "700" }}
        >
          {subject}
        </Text>
        <Text style={{ color: colors.secondaryLabel, fontSize: 12, fontVariant: ["tabular-nums"] }}>
          {formatTime(entry.occurredAt)}
        </Text>
        <SymbolView
          name="chevron.right"
          tintColor={colors.tertiaryLabel}
          size={13}
          accessible={false}
        />
      </View>
      <Text
        numberOfLines={1}
        style={{ color: colors.secondaryLabel, fontSize: 14, paddingLeft: 32 }}
      >
        {sourceLabel} · {context}
      </Text>
      {method ? (
        <Text
          numberOfLines={1}
          style={{ color: colors.tertiaryLabel, fontSize: 12, paddingLeft: 32 }}
        >
          {method}
        </Text>
      ) : null}
      {entry.notes ? (
        <Text
          numberOfLines={1}
          selectable
          style={{ color: colors.tertiaryLabel, fontSize: 12, paddingLeft: 32 }}
        >
          {entry.notes}
        </Text>
      ) : null}
    </Pressable>
  );
}

function contextLabel(entry: ScanLogEntry, t: ReturnType<typeof useLocale>["t"]): string {
  if (entry.source === "activity") {
    const activity = entry.activityName ?? entry.detail ?? t("scanLogUnknownActivity");
    return entry.activityCategory ? `${activity} · ${entry.activityCategory}` : activity;
  }
  if (entry.source === "door") {
    const direction = entry.doorKind === "out" ? t("scannerOut") : t("scannerIn");
    return entry.doorLocation ? `${direction} · ${entry.doorLocation}` : direction;
  }
  return entry.badgeId ? `${t("scanLogBadge")} ${entry.badgeId}` : t("scanLogAccreditation");
}

function methodLabel(entry: ScanLogEntry, t: ReturnType<typeof useLocale>["t"]): string | null {
  if (entry.source !== "accreditation" || !entry.method) return null;
  const method =
    entry.method === "qr"
      ? t("scanLogMethodQr")
      : entry.method === "nfc"
        ? t("scanLogMethodNfc")
        : t("scanLogMethodManual");
  return entry.badgeId ? `${method} · ${t("scanLogBadge")} ${entry.badgeId}` : method;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
