import { EVENTS, type SseEnvelope } from "@hackos/shared/events";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text, useColorScheme, View } from "react-native";
import { EmptyState, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { subscribeToCategory } from "@/lib/notification-events";
import { subscribeToServerEvent } from "@/lib/server-events";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

interface QueueRoom {
  id: number;
  name: string;
  location: string | null;
}

interface QueueEntry {
  entryId: number;
  challengeTitle: string;
  repoName: string;
  status: string;
  position: number | null;
  etaMinutes: number | null;
  room: QueueRoom | null;
  rooms: QueueRoom[];
}

const POLL_MS = 15_000;

/** Live participant queue, matching the web read model and SSE events. */
export default function QueueScreen() {
  useColorScheme();
  const { t } = useLocale();
  const { me } = useMeContext();
  const androidTopInset = useAndroidTopInset();
  const [precalled, setPrecalled] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const fetchQueue = useCallback(() => apiFetch<QueueEntry[]>("/api/queue/me"), []);
  const { data, loading, error, staleSince, load } = useCachedApi(
    `user:${me?.id ?? "unknown"}:queue`,
    fetchQueue,
  );
  const entries = data ?? [];

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToCategory("queue", () => void load()), [load]);

  useEffect(() => {
    const onPrecall = (event: SseEnvelope) => {
      const entryId = (event.data as { entryId?: number }).entryId;
      if (entryId != null) setPrecalled((current) => new Set(current).add(entryId));
      void load();
    };
    const onCalled = (event: SseEnvelope) => {
      const entryId = (event.data as { entryId?: number }).entryId;
      if (entryId != null) {
        setPrecalled((current) => {
          const next = new Set(current);
          next.delete(entryId);
          return next;
        });
      }
      void load();
    };
    return combineCleanups([
      subscribeToServerEvent(EVENTS.USER_QUEUE_PRECALL, onPrecall),
      subscribeToServerEvent(EVENTS.USER_QUEUE_CALLED, onCalled),
      subscribeToServerEvent(EVENTS.USER_QUEUE_CHANGED, () => void load()),
    ]);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const orderedEntries = useMemo(
    () =>
      [...entries].sort((a, b) => {
        const calledDifference = Number(b.status === "called") - Number(a.status === "called");
        if (calledDifference !== 0) return calledDifference;
        const etaA = a.etaMinutes ?? Number.POSITIVE_INFINITY;
        const etaB = b.etaMinutes ?? Number.POSITIVE_INFINITY;
        if (etaA !== etaB) return etaA - etaB;
        return (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY);
      }),
    [entries],
  );

  return (
    <FlatList
      data={orderedEntries}
      keyExtractor={(item) => String(item.entryId)}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        gap: 12,
        padding: 16,
        paddingTop: 16 + androidTopInset,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <StaleDataBanner updatedAt={staleSince} onRetry={() => void load()} retrying={loading} />
      }
      ListEmptyComponent={
        loading ? (
          <RequestFeedback loading />
        ) : error ? (
          <RequestFeedback error={error} onRetry={() => void load()} />
        ) : (
          <EmptyState
            icon="person.line.dotted.person.fill"
            title={t("queueEmptyTitle")}
            description={t("queueEmpty")}
          />
        )
      }
      renderItem={({ item }) => <QueueCard item={item} precalled={precalled.has(item.entryId)} />}
    />
  );
}

function combineCleanups(cleanups: Array<() => void>) {
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function QueueCard({ item, precalled }: { item: QueueEntry; precalled: boolean }) {
  const { t } = useLocale();
  const calledRoom = item.status === "called" ? item.room : null;
  const eta = formatEta(item.etaMinutes, t);

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: 16,
        gap: 14,
        padding: 16,
      }}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text selectable style={{ color: colors.label, fontSize: 18, fontWeight: "700" }}>
            {item.challengeTitle}
          </Text>
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
            {item.repoName}
          </Text>
        </View>
        <StatusPill tone={statusTone(item.status)}>{statusLabel(item.status, t)}</StatusPill>
      </View>

      {calledRoom ? (
        <View
          accessibilityRole="alert"
          style={{
            backgroundColor: colors.successSurface,
            borderCurve: "continuous",
            borderRadius: 12,
            gap: 7,
            padding: 14,
          }}
        >
          <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
            <SymbolView
              name="door.left.hand.open"
              tintColor={colors.onSuccessSurface}
              size={22}
              accessible={false}
            />
            <Text
              selectable
              style={{ color: colors.onSuccessSurface, flex: 1, fontSize: 17, fontWeight: "800" }}
            >
              {t("queueCalled", { room: calledRoom.name })}
            </Text>
          </View>
          {calledRoom.location ? (
            <Text
              selectable
              style={{ color: colors.onSuccessSurface, fontSize: 14, paddingLeft: 30 }}
            >
              {calledRoom.location}
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          {precalled ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: colors.warningSurface,
                borderCurve: "continuous",
                borderRadius: 12,
                flexDirection: "row",
                gap: 8,
                padding: 12,
              }}
            >
              <SymbolView
                name="bell.badge.fill"
                tintColor={colors.onWarningSurface}
                size={19}
                accessible={false}
              />
              <Text
                selectable
                style={{ color: colors.onWarningSurface, flex: 1, fontSize: 15, fontWeight: "700" }}
              >
                {t("queuePrecalled")}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <QueueMetric
              icon="number.circle"
              label={t("queuePositionLabel")}
              value={item.position != null ? String(item.position) : "—"}
            />
            <QueueMetric icon="hourglass" label={t("queueWaitLabel")} value={eta ?? "—"} />
          </View>
          {item.rooms.length ? (
            <View style={{ gap: 8 }}>
              <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
                <SymbolView
                  name="door.left.hand.closed"
                  tintColor={colors.secondaryLabel}
                  size={15}
                  accessible={false}
                />
                <Text
                  selectable
                  style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}
                >
                  {t("queuePossibleRoomsLabel")}
                </Text>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                {item.rooms.map((room) => (
                  <RoomChip key={room.id} room={room} />
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function QueueMetric({
  icon,
  label,
  value,
}: {
  icon: "number.circle" | "hourglass";
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderCurve: "continuous",
        borderRadius: 12,
        flex: 1,
        gap: 5,
        padding: 12,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        <SymbolView name={icon} tintColor={colors.secondaryLabel} size={15} accessible={false} />
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, fontWeight: "600" }}>
          {label}
        </Text>
      </View>
      <Text
        selectable
        style={{
          color: colors.label,
          fontSize: 20,
          fontVariant: ["tabular-nums"],
          fontWeight: "700",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function RoomChip({ room }: { room: QueueRoom }) {
  return (
    <View
      style={{
        alignItems: "baseline",
        backgroundColor: colors.background,
        borderCurve: "continuous",
        borderRadius: 9,
        flexDirection: "row",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 7,
      }}
    >
      <Text selectable style={{ color: colors.label, fontSize: 13, fontWeight: "600" }}>
        {room.name}
      </Text>
      {room.location ? (
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12 }}>
          {room.location}
        </Text>
      ) : null}
    </View>
  );
}

function formatEta(minutes: number | null, t: ReturnType<typeof useLocale>["t"]) {
  if (minutes == null) return null;
  if (minutes <= 0) return t("queueAnyMoment");
  if (minutes < 60) return t("queueEtaMinutes", { minutes: String(minutes) });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? t("queueEtaHoursMinutes", { hours: String(hours), minutes: String(remainder) })
    : t("queueEtaHours", { hours: String(hours) });
}

function statusTone(status: string): "neutral" | "accent" | "success" | "warning" | "destructive" {
  if (status === "called") return "success";
  if (status === "waiting") return "accent";
  if (status === "disqualified") return "destructive";
  if (status === "completed") return "neutral";
  return "warning";
}

function statusLabel(status: string, t: ReturnType<typeof useLocale>["t"]) {
  const labels: Record<string, string> = {
    waiting: t("queueStatusWaiting"),
    called: t("queueStatusCalled"),
    in_room: t("queueStatusInRoom"),
    presenting: t("queueStatusPresenting"),
    completed: t("queueStatusCompleted"),
    disqualified: t("queueStatusDisqualified"),
  };
  return labels[status] ?? status.replaceAll("_", " ");
}
