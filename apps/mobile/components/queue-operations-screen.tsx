import { MenuView } from "@expo/ui/community/menu";
import { EVENTS, type SseEnvelope } from "@hackos/shared/events";
import { useFocusEffect, useNavigation, usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
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
import { ApiError, apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import {
  findQueueEntries,
  type QueueEntry,
  type QueueRoom,
  type QueueSearchResult,
  type RoomView,
} from "@/lib/queue-search";
import { startQueueEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { canOperateQueues, isPadIdiom } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { colors } from "@/theme/colors";

const JUST_CALLED_HIGHLIGHT_MS = 12_000;

interface RoomListItem {
  id: number;
}

const POLL_MS = 10_000;

function actionErrorMessage(cause: unknown, t: ReturnType<typeof useLocale>["t"]): string {
  if (!(cause instanceof Error)) return t("queueOpsNotifyError");
  if (cause instanceof ApiError) {
    if (cause.status === 401) return t("requestSessionExpired");
    if (cause.status === 404) return t("requestUnavailable");
    if (cause.status >= 500) return t("requestServerError");
    return t("requestError");
  }
  return t("requestError");
}

/** H29-H35 mobile operator view: room state, door queue, queue head, and re-notification. */
export function QueueOperationsScreen() {
  useColorScheme();
  const { t } = useLocale();
  const { me } = useMeContext();
  const router = useRouter();
  const pathname = usePathname();
  const usesOthersStack = isPadIdiom() && pathname.includes("/others/operations");
  const headerNavigation = useNavigation(usesOthersStack ? "/(tabs)/others" : undefined);
  const androidTopInset = useAndroidTopInset();
  const { width } = useWindowDimensions();
  const [refreshing, setRefreshing] = useState(false);
  const [notifyingEntryId, setNotifyingEntryId] = useState<number | null>(null);
  const [notifiedEntryId, setNotifiedEntryId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState<"all" | "live" | "paused">("all");
  const [justCalledEntryIds, setJustCalledEntryIds] = useState<Set<number>>(new Set());
  const canOperate = canOperateQueues(me?.capabilities ?? []);
  const columns = width >= 1_100 ? 3 : width >= 680 ? 2 : 1;
  const usesListTitle = isPadIdiom();

  const fetchRooms = useCallback(async () => {
    const rooms = await apiFetch<RoomListItem[]>("/api/queue/rooms");
    return Promise.all(rooms.map(({ id }) => apiFetch<RoomView>(`/api/queue/rooms/${id}/view`)));
  }, []);
  const { data, loading, error, staleSince, load } = useCachedApi(
    `user:${me?.id ?? "unknown"}:queue-operations`,
    fetchRooms,
  );
  const rooms = data ?? [];

  useLayoutEffect(() => {
    headerNavigation.setOptions({
      title: usesListTitle ? "" : t("tabQueueOperations"),
      headerLargeTitle: !usesListTitle,
      headerRight: () => (
        <MenuView
          actions={[
            {
              id: "all",
              title: t("queueOpsFilterAll"),
              image: "square.grid.2x2",
              state: roomFilter === "all" ? "on" : "off",
            },
            {
              id: "live",
              title: t("queueOpsFilterLive"),
              image: "play.circle",
              state: roomFilter === "live" ? "on" : "off",
            },
            {
              id: "paused",
              title: t("queueOpsFilterPaused"),
              image: "pause.circle",
              state: roomFilter === "paused" ? "on" : "off",
            },
          ]}
          onPressAction={({ nativeEvent }) => setRoomFilter(nativeEvent.event as typeof roomFilter)}
        >
          <SymbolView
            name={
              roomFilter === "all"
                ? "line.3.horizontal.decrease"
                : "line.3.horizontal.decrease.circle.fill"
            }
            tintColor={colors.accent}
            size={19}
          />
        </MenuView>
      ),
      headerSearchBarOptions: {
        placeholder: t("queueOpsSearchPlaceholder"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: true,
        // Match the People directory: keep the inactive search control as a
        // compact native button even when regular-width iPad has room.
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
      },
    });
  }, [headerNavigation, roomFilter, t, usesListTitle]);

  const visibleRooms = useMemo(
    () =>
      rooms.filter((room) => {
        if (roomFilter === "all") return true;
        return roomFilter === "paused" ? room.state?.is_paused === true : !room.state?.is_paused;
      }),
    [roomFilter, rooms],
  );
  const searchActive = query.trim().length > 0;
  const searchResults = useMemo(
    () => (searchActive ? findQueueEntries(visibleRooms, query) : []),
    [searchActive, query, visibleRooms],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  // H29/H31: mark a just-called entry so it stands out on the board without
  // waiting for the next poll.
  useFocusEffect(
    useCallback(() => {
      if (!canOperate) return;
      const stopStream = startQueueEventStream(canOperate);
      const timers = new Map<number, ReturnType<typeof setTimeout>>();
      const markCalled = (entryId: number) => {
        setJustCalledEntryIds((current) => new Set(current).add(entryId));
        const existing = timers.get(entryId);
        if (existing) clearTimeout(existing);
        timers.set(
          entryId,
          setTimeout(() => {
            setJustCalledEntryIds((current) => {
              const next = new Set(current);
              next.delete(entryId);
              return next;
            });
            timers.delete(entryId);
          }, JUST_CALLED_HIGHLIGHT_MS),
        );
      };
      const onTeamCalled = (event: SseEnvelope) => {
        const entryId = (event.data as { entryId?: number }).entryId;
        if (entryId != null) markCalled(entryId);
        void load();
      };
      const onEntryChanged = () => void load();
      const unsubscribeCalled = subscribeToServerEvent(EVENTS.QUEUE_TEAM_CALLED, onTeamCalled);
      const unsubscribeChanged = subscribeToServerEvent(EVENTS.QUEUE_ENTRY_CHANGED, onEntryChanged);
      const unsubscribeRoom = subscribeToServerEvent(EVENTS.QUEUE_ROOM_CHANGED, onEntryChanged);
      return () => {
        stopStream();
        unsubscribeCalled();
        unsubscribeChanged();
        unsubscribeRoom();
        for (const timer of timers.values()) clearTimeout(timer);
      };
    }, [canOperate, load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openTeam = useCallback(
    (entryId: number, roomId: number) => {
      router.push({
        pathname: "/(tabs)/others/team/[entryId]",
        params: { entryId: String(entryId), roomId: String(roomId) },
      });
    },
    [router],
  );

  const notifyTeam = useCallback(
    async (entryId: number) => {
      setActionError(null);
      setNotifiedEntryId(null);
      setNotifyingEntryId(entryId);
      try {
        await apiFetch(`/api/queue/entries/${entryId}/notify-enter`, {
          method: "POST",
          headers: { "Idempotency-Key": createIdempotencyKey() },
        });
        setNotifiedEntryId(entryId);
        void haptic("success");
        await load();
      } catch (cause) {
        setActionError(actionErrorMessage(cause, t));
      } finally {
        setNotifyingEntryId(null);
      }
    },
    [load, t],
  );

  if (!canOperate) {
    return (
      <EmptyState
        icon="lock.fill"
        title={t("queueOpsAccessTitle")}
        description={t("queueOpsAccessDescription")}
      />
    );
  }

  const actionErrorBanner = actionError ? (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: colors.destructiveSurface,
        borderCurve: "continuous",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text selectable style={{ color: colors.onDestructiveSurface, fontSize: 14 }}>
        {actionError}
      </Text>
    </View>
  ) : null;

  if (searchActive) {
    return (
      <FlatList
        data={searchResults}
        keyExtractor={(item) => String(item.entry.id)}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          gap: 12,
          padding: 16,
          paddingTop: 16 + androidTopInset,
        }}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {usesListTitle ? <QueueOperationsListTitle /> : null}
            {/* Zero is left to the empty state below — it already says "No results". */}
            {searchResults.length ? <SearchResultCount count={searchResults.length} /> : null}
            {actionErrorBanner}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="person.crop.badge.magnifyingglass"
            title={t("scannerNoResults")}
            description={t("queueOpsNoSearchResults")}
          />
        }
        renderItem={({ item }) => (
          <TeamQueueCard
            result={item}
            highlighted={justCalledEntryIds.has(item.entry.id)}
            onPress={() => openTeam(item.entry.id, item.rooms[0].id)}
          />
        )}
      />
    );
  }

  return (
    <FlatList
      key={columns}
      data={visibleRooms}
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
          {usesListTitle ? <QueueOperationsListTitle /> : null}
          <StaleDataBanner updatedAt={staleSince} />
          {actionErrorBanner}
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
          justCalledEntryIds={justCalledEntryIds}
          columns={columns}
          onNotify={notifyTeam}
          onOpenTeam={openTeam}
        />
      )}
    />
  );
}

function QueueOperationsListTitle() {
  const { t } = useLocale();
  return (
    <Text style={{ color: colors.label, fontSize: 34, fontWeight: "700", paddingVertical: 8 }}>
      {t("tabQueueOperations")}
    </Text>
  );
}

function queueStatusLabel(status: string, t: ReturnType<typeof useLocale>["t"]): string {
  switch (status) {
    case "called":
      return t("queueStatusCalled");
    case "in_room":
      return t("queueStatusInRoom");
    case "presenting":
      return t("queueStatusPresenting");
    case "completed":
      return t("queueStatusCompleted");
    case "disqualified":
      return t("queueStatusDisqualified");
    default:
      return t("queueStatusWaiting");
  }
}

function statusTone(status: string): "neutral" | "accent" | "success" | "warning" | "destructive" {
  if (status === "called") return "success";
  if (status === "waiting") return "accent";
  if (status === "disqualified") return "destructive";
  if (status === "completed") return "neutral";
  return "warning";
}

/** Result count under the search bar, so the operator knows the scope of what they are seeing. */
function SearchResultCount({ count }: { count: number }) {
  const { t } = useLocale();
  return (
    <Text
      accessibilityLiveRegion="polite"
      selectable
      style={{ color: colors.secondaryLabel, fontSize: 13, fontWeight: "600" }}
    >
      {count === 1
        ? t("queueOpsSearchResultCountOne")
        : t("queueOpsSearchResultCount", { count: String(count) })}
    </Text>
  );
}

/** Same card the participant sees on their own My Queue screen, plus the rooms and a tap-through to more detail. */
function TeamQueueCard({
  result,
  highlighted,
  onPress,
}: {
  result: QueueSearchResult;
  highlighted: boolean;
  onPress: () => void;
}) {
  const { t } = useLocale();
  const { entry, rooms, challengeTitle } = result;
  // A called team is at one specific door; a waiting one may be judged in any
  // of the rooms that share its challenge, so list them all in this one card.
  const calledRoom = entry.status === "called" ? (rooms[0] ?? null) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={t("queueOpsViewTeamHint")}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.surface,
        borderColor: highlighted ? colors.accent : "transparent",
        borderCurve: "continuous",
        borderRadius: 16,
        borderWidth: 2,
        gap: 12,
        opacity: pressed ? 0.8 : 1,
        padding: 16,
      })}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            selectable
            numberOfLines={1}
            style={{ color: colors.label, fontSize: 17, fontWeight: "700" }}
          >
            {challengeTitle ?? t("queueOpsNoChallenge")}
          </Text>
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
            {entry.repo_name ?? t("queueOpsUnnamedTeam")}
          </Text>
        </View>
        <StatusPill tone={statusTone(entry.status)}>{queueStatusLabel(entry.status, t)}</StatusPill>
      </View>

      {calledRoom ? (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.successSurface,
            borderCurve: "continuous",
            borderRadius: 12,
            flexDirection: "row",
            gap: 8,
            padding: 12,
          }}
        >
          <SymbolView
            name="door.left.hand.open"
            tintColor={colors.onSuccessSurface}
            size={19}
            accessible={false}
          />
          <Text
            style={{ color: colors.onSuccessSurface, flex: 1, fontSize: 15, fontWeight: "700" }}
          >
            {calledRoom.name}
            {calledRoom.location ? ` · ${calledRoom.location}` : ""}
          </Text>
        </View>
      ) : (
        <>
          {entry.position != null ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <QueueMetric
                icon="number.circle"
                label={t("queuePositionLabel")}
                value={String(entry.position)}
              />
            </View>
          ) : null}
          {rooms.length ? (
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
                {rooms.map((room) => (
                  <RoomChip key={room.id} room={room} />
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

function QueueMetric({
  icon,
  label,
  value,
}: {
  icon: "number.circle" | "door.left.hand.closed";
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
        numberOfLines={1}
        style={{ color: colors.label, fontSize: 18, fontWeight: "700" }}
      >
        {value}
      </Text>
    </View>
  );
}

/** Mirrors the participant My Queue room chip (app/(tabs)/queue.tsx). */
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

function RoomCard({
  room,
  columns,
  busyEntryId,
  notifiedEntryId,
  justCalledEntryIds,
  onNotify,
  onOpenTeam,
}: {
  room: RoomView;
  columns: number;
  busyEntryId: number | null;
  notifiedEntryId: number | null;
  justCalledEntryIds: Set<number>;
  onNotify: (entryId: number) => void;
  onOpenTeam: (entryId: number, roomId: number) => void;
}) {
  const { t } = useLocale();
  const next = room.next[0] ?? null;
  const paused = room.state?.is_paused ?? true;
  const roomJustCalled = [room.active, ...room.called, ...room.next].some(
    (entry) => entry != null && justCalledEntryIds.has(entry.id),
  );

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderColor: roomJustCalled ? colors.accent : colors.separator,
        borderCurve: "continuous",
        borderRadius: 16,
        borderWidth: roomJustCalled ? 2 : 1,
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
        {roomJustCalled ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              alignItems: "center",
              backgroundColor: colors.accentSurface,
              borderCurve: "continuous",
              borderRadius: 999,
              flexDirection: "row",
              gap: 4,
              paddingHorizontal: 9,
              paddingVertical: 5,
            }}
          >
            <SymbolView
              name="bell.badge.fill"
              tintColor={colors.onAccentSurface}
              size={12}
              accessible={false}
            />
            <Text style={{ color: colors.onAccentSurface, fontSize: 12, fontWeight: "700" }}>
              {t("queueOpsJustCalled")}
            </Text>
          </View>
        ) : null}
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
        highlighted={room.active != null && justCalledEntryIds.has(room.active.id)}
        onPress={room.active ? () => onOpenTeam(room.active!.id, room.room.id) : undefined}
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
          room.called.map((entry) => {
            const justCalled = justCalledEntryIds.has(entry.id);
            return (
              <View
                key={entry.id}
                style={{
                  backgroundColor: colors.accentSurface,
                  borderColor: justCalled ? colors.accent : "transparent",
                  borderCurve: "continuous",
                  borderRadius: 12,
                  borderWidth: 2,
                  gap: 4,
                  padding: 12,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t("queueOpsViewTeamHint")}
                  onPress={() => onOpenTeam(entry.id, room.room.id)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    selectable
                    numberOfLines={1}
                    style={{ color: colors.label, flex: 1, fontSize: 15, fontWeight: "700" }}
                  >
                    {entry.repo_name ?? t("queueOpsUnnamedTeam")}
                  </Text>
                  {justCalled ? (
                    <SymbolView
                      name="bell.badge.fill"
                      tintColor={colors.accent}
                      size={14}
                      accessible={false}
                    />
                  ) : null}
                  <SymbolView name="chevron.right" tintColor={colors.tertiaryLabel} size={13} />
                </Pressable>
                <ActionButton
                  busy={busyEntryId === entry.id}
                  haptic={false}
                  icon="bell.badge.fill"
                  label={t("queueOpsNotifyTeam")}
                  onPress={() => onNotify(entry.id)}
                  style={{ alignSelf: "flex-start", minHeight: 44, paddingHorizontal: 0 }}
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
            );
          })
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
        onPress={next ? () => onOpenTeam(next.id, room.room.id) : undefined}
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
  highlighted = false,
  onPress,
}: {
  icon: "person.2.fill" | "number.circle";
  label: string;
  entry: QueueEntry | null;
  empty: string;
  showPosition?: boolean;
  highlighted?: boolean;
  onPress?: () => void;
}) {
  const { t } = useLocale();
  const content = (
    <>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        <SymbolView name={icon} tintColor={colors.secondaryLabel} size={16} accessible={false} />
        <Text
          selectable
          style={{ color: colors.secondaryLabel, flex: 1, fontSize: 12, fontWeight: "600" }}
        >
          {label}
        </Text>
        {highlighted ? (
          <SymbolView
            name="bell.badge.fill"
            tintColor={colors.accent}
            size={14}
            accessible={false}
          />
        ) : null}
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
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityHint={t("queueOpsViewTeamHint")}
        onPress={onPress}
        style={({ pressed }) => ({
          backgroundColor: colors.background,
          borderColor: highlighted ? colors.accent : "transparent",
          borderCurve: "continuous",
          borderRadius: 12,
          borderWidth: 2,
          gap: 5,
          opacity: pressed ? 0.7 : 1,
          padding: 12,
        })}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderColor: highlighted ? colors.accent : "transparent",
        borderCurve: "continuous",
        borderRadius: 12,
        borderWidth: 2,
        gap: 5,
        padding: 12,
      }}
    >
      {content}
    </View>
  );
}
