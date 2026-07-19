import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  RefreshControl,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import { ActionButton, EmptyState, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { canOperateQueues } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

interface QueueEntry {
  id: number;
  repo_name?: string;
  position: number | null;
  status: string;
}

interface RoomView {
  room: { id: number; name: string; location: string | null };
  state: { is_paused: boolean } | null;
  challenge: { id: number; title: string; enterprise_name: string } | null;
  active: QueueEntry | null;
  called: QueueEntry[];
  next: QueueEntry[];
}

interface RoomListItem {
  id: number;
}

const POLL_MS = 10_000;

/** H29-H35 mobile operator view: room state, door queue, queue head, and re-notification. */
export function QueueOperationsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const { me } = useMeContext();
  const androidTopInset = useAndroidTopInset();
  const { width } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [notifyingEntryId, setNotifyingEntryId] = useState<number | null>(null);
  const [notifiedEntryId, setNotifiedEntryId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const columns = width >= 1_100 ? 3 : width >= 680 ? 2 : 1;

  const fetchRooms = useCallback(async () => {
    // Listing first keeps this screen capability-gated at the API boundary;
    // the public TV aggregate intentionally has a less detailed contract.
    const rooms = await apiFetch<RoomListItem[]>("/api/queue/rooms");
    return Promise.all(rooms.map(({ id }) => apiFetch<RoomView>(`/api/queue/rooms/${id}/view`)));
  }, []);
  const { data, loading, error, staleSince, load } = useCachedApi(
    `user:${me?.id ?? "unknown"}:queue-operations`,
    fetchRooms,
  );
  const rooms = data ?? [];

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const notifyTeam = useCallback(
    async (entryId: number) => {
      setActionError(null);
      setNotifiedEntryId(null);
      setNotifyingEntryId(entryId);
      try {
        await apiFetch(`/api/queue/entries/${entryId}/notify-enter`, {
          method: "POST",
          headers: { "Idempotency-Key": globalThis.crypto.randomUUID() },
        });
        setNotifiedEntryId(entryId);
        await load();
      } catch (cause) {
        setActionError(cause instanceof Error ? cause.message : t("queueOpsNotifyError"));
      } finally {
        setNotifyingEntryId(null);
      }
    },
    [load, t],
  );

  if (!canOperateQueues(me?.capabilities ?? [])) {
    return (
      <EmptyState
        icon="lock.fill"
        title={t("queueOpsAccessTitle")}
        description={t("queueOpsAccessDescription")}
      />
    );
  }

  return (
    <FlatList
      key={columns}
      data={rooms}
      keyExtractor={(item) => String(item.room.id)}
      numColumns={columns}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        gap: 12,
        padding: 16,
        paddingTop: 16 + androidTopInset,
      }}
      columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <View style={{ gap: 4 }}>
            <Text selectable style={{ color: colors.label, fontSize: 25, fontWeight: "700" }}>
              {t("queueOpsTitle")}
            </Text>
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
              {t("queueOpsSubtitle")}
            </Text>
          </View>
          <StaleDataBanner updatedAt={staleSince} />
          {actionError ? (
            <View
              accessibilityRole="alert"
              style={{
                backgroundColor: colors.destructiveSurface,
                borderCurve: "continuous",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text selectable style={{ color: colors.destructive, fontSize: 14 }}>
                {actionError}
              </Text>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loading ? (
          <RequestFeedback loading />
        ) : error ? (
          <RequestFeedback error={error} onRetry={() => void load()} />
        ) : (
          <EmptyState
            icon="door.left.hand.closed"
            title={t("queueOpsEmptyTitle")}
            description={t("queueOpsEmptyDescription")}
          />
        )
      }
      renderItem={({ item }) => (
        <RoomCard
          room={item}
          busyEntryId={notifyingEntryId}
          notifiedEntryId={notifiedEntryId}
          columns={columns}
          onNotify={notifyTeam}
        />
      )}
    />
  );
}

function RoomCard({
  room,
  columns,
  busyEntryId,
  notifiedEntryId,
  onNotify,
}: {
  room: RoomView;
  columns: number;
  busyEntryId: number | null;
  notifiedEntryId: number | null;
  onNotify: (entryId: number) => void;
}) {
  const { t } = useLocale();
  const next = room.next[0] ?? null;
  const paused = room.state?.is_paused ?? true;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.separator,
        borderCurve: "continuous",
        borderRadius: 16,
        borderWidth: 1,
        flex: 1,
        gap: 14,
        padding: 16,
        ...(columns > 1 ? { minWidth: 0 } : {}),
      }}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            selectable
            numberOfLines={1}
            style={{ color: colors.label, fontSize: 18, fontWeight: "700" }}
          >
            {room.room.name}
          </Text>
          <Text selectable numberOfLines={1} style={{ color: colors.secondaryLabel, fontSize: 13 }}>
            {room.room.location ?? t("queueOpsNoLocation")}
          </Text>
        </View>
        <StatusPill tone={paused ? "warning" : "success"}>
          {paused ? t("queueOpsPaused") : t("queueOpsLive")}
        </StatusPill>
      </View>

      <View style={{ gap: 3 }}>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, fontWeight: "600" }}>
          {t("queueOpsChallenge")}
        </Text>
        <Text
          selectable
          numberOfLines={2}
          style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}
        >
          {room.challenge?.title ?? t("queueOpsNoChallenge")}
        </Text>
      </View>

      <QueueSlot
        icon="person.2.fill"
        label={t("queueOpsPresenting")}
        entry={room.active}
        empty={t("queueOpsNoTeamPresenting")}
      />

      <View style={{ gap: 8 }}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
          <SymbolView
            name="door.left.hand.open"
            tintColor={colors.secondaryLabel}
            size={16}
            accessible={false}
          />
          <Text
            selectable
            style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "700" }}
          >
            {t("queueOpsAtDoor", { count: String(room.called.length) })}
          </Text>
        </View>
        {room.called.length ? (
          room.called.map((entry) => (
            <View
              key={entry.id}
              style={{
                backgroundColor: colors.accentSurface,
                borderCurve: "continuous",
                borderRadius: 12,
                gap: 4,
                padding: 12,
              }}
            >
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.label, fontSize: 15, fontWeight: "700" }}
              >
                {entry.repo_name ?? t("queueOpsUnnamedTeam")}
              </Text>
              <ActionButton
                busy={busyEntryId === entry.id}
                icon="bell.badge.fill"
                label={t("queueOpsNotifyTeam")}
                onPress={() => onNotify(entry.id)}
                style={{ alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 0 }}
              />
              {notifiedEntryId === entry.id ? (
                <Text
                  accessibilityLiveRegion="polite"
                  selectable
                  style={{ color: colors.success, fontSize: 13 }}
                >
                  {t("queueOpsTeamNotified")}
                </Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
            {t("queueOpsNoTeamsAtDoor")}
          </Text>
        )}
      </View>

      <QueueSlot
        icon="number.circle"
        label={t("queueOpsFirstInQueue")}
        entry={next}
        empty={t("queueOpsNoTeamWaiting")}
        showPosition
      />
    </View>
  );
}

function QueueSlot({
  icon,
  label,
  entry,
  empty,
  showPosition = false,
}: {
  icon: "person.2.fill" | "number.circle";
  label: string;
  entry: QueueEntry | null;
  empty: string;
  showPosition?: boolean;
}) {
  const { t } = useLocale();
  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderCurve: "continuous",
        borderRadius: 12,
        gap: 5,
        padding: 12,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        <SymbolView name={icon} tintColor={colors.secondaryLabel} size={16} accessible={false} />
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12, fontWeight: "600" }}>
          {label}
        </Text>
      </View>
      <Text
        selectable
        numberOfLines={1}
        style={{ color: colors.label, fontSize: 16, fontWeight: "700" }}
      >
        {entry?.repo_name ?? empty}
      </Text>
      {showPosition && entry?.position != null ? (
        <Text
          selectable
          style={{ color: colors.secondaryLabel, fontSize: 13, fontVariant: ["tabular-nums"] }}
        >
          {t("queueOpsPosition", { position: String(entry.position) })}
        </Text>
      ) : null}
    </View>
  );
}
