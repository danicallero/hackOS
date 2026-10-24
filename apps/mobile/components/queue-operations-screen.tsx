import { EVENTS, type SseEnvelope } from "@hackos/shared/events";
import { useFocusEffect, useNavigation, usePathname, useRouter } from "expo-router";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { FlatList, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { FilterMenu } from "@/components/filter-menu";
import { ActionButton, EmptyState, StatusPill } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { ApiError, apiFetch } from "@/lib/api";
import { useBarTitleOptions } from "@/lib/bar-title";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  findQueueEntries,
  type QueueEntry,
  type QueueRoom,
  type QueueSearchResult,
  type RoomView,
} from "@/lib/queue-search";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { startQueueEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { canOperateQueues, isPadIdiom } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { radius, type } from "@/theme";
import { colors } from "@/theme/colors";

const JUST_CALLED_HIGHLIGHT_MS = 12_000;

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
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const { width } = useWindowDimensions();
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notifyingEntryId, setNotifyingEntryId] = useState<number | null>(null);
  const [notifiedEntryId, setNotifiedEntryId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roomFilters, setRoomFilters] = useState<string[]>([]);
  const [justCalledEntryIds, setJustCalledEntryIds] = useState<Set<number>>(new Set());
  const canOperate = canOperateQueues(me?.capabilities ?? []);
  const columns = width >= 1_100 ? 3 : width >= 680 ? 2 : 1;
  const usesListTitle = isPadIdiom();

  const fetchRooms = useCallback(() => apiFetch<RoomView[]>("/api/queue/rooms/views"), []);
  const { data, loading, error, staleSince, load } = useCachedApi(
    `user:${me?.id ?? "unknown"}:queue-operations`,
    fetchRooms,
    { enabled: me !== null },
  );
  const rooms = data ?? [];

  const selectRoomFilter = useCallback((id: string) => {
    setRoomFilters((current) =>
      id === "all"
        ? []
        : current.includes(id)
          ? current.filter((status) => status !== id)
          : [...current, id],
    );
  }, []);

  const barTitle = useBarTitleOptions(t("tabQueueOperations"));
  useLayoutEffect(() => {
    headerNavigation.setOptions({
      ...(usesListTitle ? { title: "", headerLargeTitle: false } : barTitle),
      headerRight: () => (
        <FilterMenu
          embedded
          accessibilityLabel={t("scheduleFilter")}
          active={roomFilters.length > 0}
          items={[
            {
              id: "all",
              label: t("queueOpsFilterAll"),
              icon: "square.grid.2x2",
              selected: roomFilters.length === 0,
            },
            {
              id: "live",
              label: t("queueOpsFilterLive"),
              icon: "play.circle",
              selected: roomFilters.includes("live"),
            },
            {
              id: "paused",
              label: t("queueOpsFilterPaused"),
              icon: "pause.circle",
              selected: roomFilters.includes("paused"),
            },
          ]}
          onSelect={selectRoomFilter}
        />
      ),
      headerSearchBarOptions: {
        placeholder: t("queueOpsSearchPlaceholder"),
        autoCapitalize: "none",
        hideWhenScrolling: true,
        allowToolbarIntegration: false,
        // Match the People directory: keep the inactive search control as a
        // compact native button even when regular-width iPad has room.
        placement: "integratedButton",
        onChangeText: (event: { nativeEvent: { text: string } }) =>
          setQuery(event.nativeEvent.text),
      },
    });
  }, [headerNavigation, roomFilters, selectRoomFilter, t, usesListTitle, barTitle]);

  const visibleRooms = useMemo(
    () =>
      rooms.filter((room) => {
        if (roomFilters.length === 0) return true;
        return roomFilters.includes(room.state?.is_paused === true ? "paused" : "live");
      }),
    [roomFilters, rooms],
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
      if (realtimeConnected) return;
      const id = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(id);
    }, [load, realtimeConnected]),
  );

  // H29/H31: mark a just-called entry so it stands out on the board without
  // waiting for the next poll.
  useFocusEffect(
    useCallback(() => {
      if (!canOperate) return;
      const stopStream = startQueueEventStream({
        enabled: canOperate,
        identityKey: me?.id,
        onConnectionChange: setRealtimeConnected,
        onResync: () => {
          void load();
        },
      });
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
      const unsubscribeCalled = subscribeToServerEvent(
        EVENTS.QUEUE_TEAM_CALLED,
        onTeamCalled,
        "queue",
      );
      const unsubscribeChanged = subscribeToServerEvent(
        EVENTS.QUEUE_ENTRY_CHANGED,
        onEntryChanged,
        "queue",
      );
      const unsubscribeRoom = subscribeToServerEvent(
        EVENTS.QUEUE_ROOM_CHANGED,
        onEntryChanged,
        "queue",
      );
      return () => {
        stopStream();
        unsubscribeCalled();
        unsubscribeChanged();
        unsubscribeRoom();
        for (const timer of timers.values()) clearTimeout(timer);
      };
    }, [canOperate, load, me?.id]),
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
        });
        setNotifiedEntryId(entryId);
        void haptic("success");
        // Do not hold the button spinner on a full board reload.
        void load();
      } catch (cause) {
        setActionError(actionErrorMessage(cause, t));
      } finally {
        setNotifyingEntryId(null);
      }
    },
    [load, t],
  );

  const renderTeamQueueCard = useCallback(
    ({ item }: { item: QueueSearchResult }) => (
      <TeamQueueCard
        result={item}
        highlighted={justCalledEntryIds.has(item.entry.id)}
        onPress={openTeam}
      />
    ),
    [justCalledEntryIds, openTeam],
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
        borderRadius: radius.control,
        padding: 12,
      }}
    >
      <Text selectable style={{ ...type.compact, color: colors.onDestructiveSurface }}>
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
          paddingBottom: tabBarBottomInset + 16,
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
        renderItem={renderTeamQueueCard}
      />
    );
  }

  const renderRoomCard = ({ item }: { item: RoomView }) => (
    <RoomCard
      room={item}
      busyEntryId={notifyingEntryId}
      notifiedEntryId={notifiedEntryId}
      justCalledEntryIds={justCalledEntryIds}
      columns={columns}
      onNotify={notifyTeam}
      onOpenTeam={openTeam}
    />
  );

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
        paddingBottom: tabBarBottomInset + 16,
        paddingTop: 16 + androidTopInset,
      }}
      columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
      refreshControl={
        <AppRefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
      }
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
      renderItem={renderRoomCard}
    />
  );
}

function QueueOperationsListTitle() {
  const { t } = useLocale();
  return (
    <Text
      style={{ ...type.largeTitle, color: colors.label, fontWeight: "700", paddingVertical: 8 }}
    >
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
      style={{ ...type.footnote, color: colors.secondaryLabel, fontWeight: "600" }}
    >
      {count === 1
        ? t("queueOpsSearchResultCountOne")
        : t("queueOpsSearchResultCount", { count: String(count) })}
    </Text>
  );
}

/** Same card the participant sees on their own My Queue screen, plus the rooms and a tap-through to more detail. */
const TeamQueueCard = memo(function TeamQueueCard({
  result,
  highlighted,
  onPress,
}: {
  result: QueueSearchResult;
  highlighted: boolean;
  onPress: (entryId: number, roomId: number) => void;
}) {
  const { t } = useLocale();
  const { entry, rooms, challengeTitle } = result;
  // A called team is at one specific door; a waiting one may be judged in any
  // of the rooms that share its challenge, so list them all in this one card.
  const calledRoom = entry.status === "called" ? (rooms[0] ?? null) : null;

  return (
    <PressableFeedback
      feedback="scale"
      accessibilityRole="button"
      accessibilityHint={t("queueOpsViewTeamHint")}
      onPress={() => onPress(entry.id, rooms[0].id)}
      style={{
        backgroundColor: colors.surface,
        borderColor: highlighted ? colors.accent : "transparent",
        borderCurve: "continuous",
        borderRadius: radius.container,
        borderWidth: 2,
        gap: 12,
        padding: 16,
      }}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            selectable
            numberOfLines={1}
            style={{ ...type.body, color: colors.label, fontWeight: "700" }}
          >
            {challengeTitle ?? t("queueOpsNoChallenge")}
          </Text>
          <Text selectable style={{ ...type.compact, color: colors.secondaryLabel }}>
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
            borderRadius: radius.control,
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
            style={{ ...type.subhead, color: colors.onSuccessSurface, flex: 1, fontWeight: "700" }}
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
                  style={{ ...type.footnote, color: colors.secondaryLabel, fontWeight: "600" }}
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
    </PressableFeedback>
  );
});

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
        borderRadius: radius.control,
        flex: 1,
        gap: 5,
        padding: 12,
      }}
    >
      <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
        <SymbolView name={icon} tintColor={colors.secondaryLabel} size={15} accessible={false} />
        <Text
          selectable
          style={{ ...type.caption, color: colors.secondaryLabel, fontWeight: "600" }}
        >
          {label}
        </Text>
      </View>
      <Text
        selectable
        numberOfLines={1}
        style={{ color: colors.label, ...type.headline, fontWeight: "700" }}
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
        borderRadius: radius.chip,
        flexDirection: "row",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 7,
      }}
    >
      <Text selectable style={{ ...type.footnote, color: colors.label, fontWeight: "600" }}>
        {room.name}
      </Text>
      {room.location ? (
        <Text selectable style={{ ...type.caption, color: colors.secondaryLabel }}>
          {room.location}
        </Text>
      ) : null}
    </View>
  );
}

const RoomCard = memo(function RoomCard({
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
        borderRadius: radius.container,
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
            style={{ color: colors.label, ...type.headline, fontWeight: "700" }}
          >
            {room.room.name}
          </Text>
          <Text
            selectable
            numberOfLines={1}
            style={{ ...type.footnote, color: colors.secondaryLabel }}
          >
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
              borderRadius: radius.full,
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
            <Text style={{ ...type.caption, color: colors.onAccentSurface, fontWeight: "700" }}>
              {t("queueOpsJustCalled")}
            </Text>
          </View>
        ) : null}
        <StatusPill tone={paused ? "warning" : "success"}>
          {paused ? t("queueOpsPaused") : t("queueOpsLive")}
        </StatusPill>
      </View>

      <View style={{ gap: 3 }}>
        <Text
          selectable
          style={{ ...type.caption, color: colors.secondaryLabel, fontWeight: "600" }}
        >
          {t("queueOpsChallenge")}
        </Text>
        <Text
          selectable
          numberOfLines={2}
          style={{ ...type.subhead, color: colors.label, fontWeight: "600" }}
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
            style={{ ...type.footnote, color: colors.secondaryLabel, fontWeight: "700" }}
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
                  borderRadius: radius.control,
                  borderWidth: 2,
                  gap: 4,
                  padding: 12,
                }}
              >
                <PressableFeedback
                  feedback="opacity"
                  accessibilityRole="button"
                  accessibilityHint={t("queueOpsViewTeamHint")}
                  onPress={() => onOpenTeam(entry.id, room.room.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Text
                    selectable
                    numberOfLines={1}
                    style={{ ...type.subhead, color: colors.label, flex: 1, fontWeight: "700" }}
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
                </PressableFeedback>
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
                    style={{ ...type.footnote, color: colors.success }}
                  >
                    {t("queueOpsTeamNotified")}
                  </Text>
                ) : null}
              </View>
            );
          })
        ) : (
          <Text selectable style={{ ...type.compact, color: colors.secondaryLabel }}>
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
});

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
          style={{ ...type.caption, color: colors.secondaryLabel, flex: 1, fontWeight: "600" }}
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
        style={{ ...type.callout, color: colors.label, fontWeight: "700" }}
      >
        {entry?.repo_name ?? empty}
      </Text>
      {showPosition && entry?.position != null ? (
        <Text
          selectable
          style={{ ...type.footnote, color: colors.secondaryLabel, fontVariant: ["tabular-nums"] }}
        >
          {t("queueOpsPosition", { position: String(entry.position) })}
        </Text>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <PressableFeedback
        feedback="scale"
        accessibilityRole="button"
        accessibilityHint={t("queueOpsViewTeamHint")}
        onPress={onPress}
        style={{
          backgroundColor: colors.background,
          borderColor: highlighted ? colors.accent : "transparent",
          borderCurve: "continuous",
          borderRadius: radius.control,
          borderWidth: 2,
          gap: 5,
          padding: 12,
        }}
      >
        {content}
      </PressableFeedback>
    );
  }

  return (
    <View
      style={{
        backgroundColor: colors.background,
        borderColor: highlighted ? colors.accent : "transparent",
        borderCurve: "continuous",
        borderRadius: radius.control,
        borderWidth: 2,
        gap: 5,
        padding: 12,
      }}
    >
      {content}
    </View>
  );
}
