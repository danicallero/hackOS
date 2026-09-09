import { EVENTS, type SseEnvelope } from "@hackos/shared/events";
import { useFocusEffect, useScrollToTop } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
  useReducedMotion,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton, EmptyState, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { SymbolView } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { subscribeToCategory } from "@/lib/notification-events";
import { hasSeenQueueTutorial, markQueueTutorialSeen } from "@/lib/queue-tutorial";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
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
  const userId = me?.id ?? null;
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const [precalled, setPrecalled] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [queueTutorialVisible, setQueueTutorialVisible] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    if (userId == null) {
      setQueueTutorialVisible(false);
      return () => {
        cancelled = true;
      };
    }
    void hasSeenQueueTutorial(userId).then((seen) => {
      if (!cancelled) setQueueTutorialVisible(!seen);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dismissQueueTutorial = useCallback(() => {
    setQueueTutorialVisible(false);
    if (userId != null) void markQueueTutorialSeen(userId);
  }, [userId]);

  const fetchQueue = useCallback(() => apiFetch<QueueEntry[]>("/api/queue/me"), []);
  const { data, loading, error, staleSince, load } = useCachedApi(
    `user:${me?.id ?? "unknown"}:queue`,
    fetchQueue,
  );
  const entries = data ?? [];

  const listRef = useRef<FlatList<QueueEntry>>(null);
  useScrollToTop(listRef);

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

  const renderQueueCard = useCallback(
    ({ item }: { item: QueueEntry }) => (
      <QueueCard item={item} precalled={precalled.has(item.entryId)} />
    ),
    [precalled],
  );

  return (
    <>
      <FlatList
        ref={listRef}
        data={orderedEntries}
        keyExtractor={(item) => String(item.entryId)}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          flexGrow: 1,
          gap: 12,
          padding: 16,
          paddingBottom: tabBarBottomInset + 16,
          paddingTop: 16 + androidTopInset,
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <StaleDataBanner updatedAt={staleSince} />
            <QueueTutorialTrigger onPress={() => setQueueTutorialVisible(true)} />
          </View>
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
        renderItem={renderQueueCard}
      />
      <QueueTutorial
        visible={queueTutorialVisible}
        bottomInset={insets.bottom}
        topInset={insets.top}
        onDismiss={dismissQueueTutorial}
      />
    </>
  );
}

function QueueTutorialTrigger({ onPress }: { onPress: () => void }) {
  const { t } = useLocale();
  const reducedMotion = useReducedMotion();

  return (
    <Pressable
      accessibilityHint={t("queueHowItWorksRevisitHint")}
      accessibilityLabel={t("queueHowItWorksTitle")}
      accessibilityRole="button"
      onPress={() => {
        void haptic("light");
        onPress();
      }}
      testID="queue-tutorial-open"
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.accentSurface,
        borderCurve: "continuous",
        borderRadius: 14,
        flexDirection: "row",
        gap: 12,
        minHeight: 70,
        opacity: pressed ? 0.84 : 1,
        paddingHorizontal: 14,
        paddingVertical: 12,
        transform: reducedMotion ? undefined : [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderRadius: 12,
          height: 42,
          justifyContent: "center",
          width: 42,
        }}
      >
        <SymbolView name="questionmark.circle" size={22} tintColor={colors.onAccentSurface} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: colors.onAccentSurface, fontSize: 16, fontWeight: "700" }}>
          {t("queueHowItWorksTitle")}
        </Text>
        <Text selectable style={{ color: colors.onAccentSurface, fontSize: 13, lineHeight: 18 }}>
          {t("queueHowItWorksRevisitBody")}
        </Text>
      </View>
      <SymbolView
        accessible={false}
        name="chevron.right"
        size={18}
        tintColor={colors.onAccentSurface}
      />
    </Pressable>
  );
}

export function QueueTutorial({
  visible,
  bottomInset,
  topInset,
  onDismiss,
}: {
  visible: boolean;
  bottomInset: number;
  topInset: number;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  const reducedMotion = useReducedMotion();
  const { fontScale, width } = useWindowDimensions();
  const steps = [
    {
      icon: "bell.badge.fill" as const,
      title: t("queueHowItWorksPrepareTitle"),
      body: t("queueHowItWorksPrepareBody"),
    },
    {
      icon: "door.left.hand.closed" as const,
      title: t("queueHowItWorksDoorTitle"),
      body: t("queueHowItWorksDoorBody"),
      note: t("queueHowItWorksDoorNote"),
    },
    {
      icon: "door.left.hand.open" as const,
      title: t("queueHowItWorksEnterTitle"),
      body: t("queueHowItWorksEnterBody"),
    },
  ];
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDirection, setStepDirection] = useState<1 | -1>(1);
  const [hasNavigated, setHasNavigated] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const currentStep = steps[stepIndex];
  const currentStepKey = currentStep?.icon ?? "";
  const bodyParagraphs = currentStep?.body.split(/\n\n+/) ?? [];
  const scrollEnabled = viewportHeight > 0 && bodyHeight > viewportHeight + 1;
  const stackFooterActions = width < 320 || fontScale > 1.3;
  const stepEntering = reducedMotion
    ? FadeIn.duration(140)
    : stepDirection > 0
      ? FadeInRight.duration(180)
      : FadeInLeft.duration(180);

  useEffect(() => {
    if (!visible) {
      setStepIndex(0);
      setStepDirection(1);
      setHasNavigated(false);
      setBodyHeight(0);
      setViewportHeight(0);
      return;
    }
    setStepIndex(0);
    setStepDirection(1);
    setHasNavigated(false);
  }, [visible]);

  useEffect(() => {
    if (!visible || !currentStepKey) return;
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
  }, [currentStepKey, visible]);

  const goBack = useCallback(() => {
    if (stepIndex === 0) return;
    void haptic("selection");
    setStepDirection(-1);
    setHasNavigated(true);
    setStepIndex((current) => current - 1);
  }, [stepIndex]);

  const advance = useCallback(() => {
    if (stepIndex === steps.length - 1) {
      void haptic("success");
      onDismiss();
      return;
    }
    void haptic("selection");
    setStepDirection(1);
    setHasNavigated(true);
    setStepIndex((current) => current + 1);
  }, [onDismiss, stepIndex, steps.length]);

  if (!currentStep) return null;

  return (
    <Modal
      animationType={reducedMotion ? "fade" : "slide"}
      accessibilityViewIsModal
      onRequestClose={onDismiss}
      transparent
      visible={visible}
    >
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        <View
          style={{
            flex: 1,
            paddingHorizontal: 24,
            paddingTop: Math.max(24, topInset + 12),
          }}
        >
          <View
            style={{
              alignSelf: "center",
              flex: 1,
              gap: 24,
              maxWidth: 560,
              width: "100%",
            }}
          >
            <View style={{ alignItems: "center", gap: 8 }}>
              <Text
                accessibilityRole="header"
                selectable
                style={{
                  color: colors.label,
                  fontSize: 28,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {t("queueHowItWorksTitle")}
              </Text>
              <Text
                selectable
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 16,
                  lineHeight: 23,
                  textAlign: "center",
                }}
              >
                {t("queueHowItWorksIntro")}
              </Text>
            </View>

            <ScrollView
              bounces={scrollEnabled}
              contentContainerStyle={{
                alignItems: "center",
                flexGrow: 1,
                justifyContent: "center",
                paddingVertical: 24,
              }}
              contentInsetAdjustmentBehavior="never"
              onContentSizeChange={(_, height) => setBodyHeight(height)}
              onLayout={({ nativeEvent }) => setViewportHeight(nativeEvent.layout.height)}
              ref={scrollRef}
              scrollEnabled={scrollEnabled}
              showsVerticalScrollIndicator={scrollEnabled}
              style={{ flex: 1 }}
              testID="queue-tutorial-scroll"
            >
              <Animated.View
                accessibilityLiveRegion={hasNavigated ? "polite" : "none"}
                entering={hasNavigated ? stepEntering : undefined}
                exiting={hasNavigated ? FadeOut.duration(reducedMotion ? 100 : 120) : undefined}
                key={`queue-tutorial-step-${stepIndex}`}
                style={{
                  alignItems: "center",
                  alignSelf: "center",
                  gap: 18,
                  maxWidth: 480,
                  paddingHorizontal: 24,
                  paddingVertical: 28,
                  width: "100%",
                }}
              >
                <View
                  style={{
                    alignItems: "center",
                    backgroundColor: colors.accentSurface,
                    borderRadius: 32,
                    height: 64,
                    justifyContent: "center",
                    width: 64,
                  }}
                >
                  <SymbolView
                    accessible={false}
                    name={currentStep.icon}
                    size={30}
                    tintColor={colors.onAccentSurface}
                  />
                </View>
                <Text
                  accessibilityRole="header"
                  selectable
                  style={{
                    color: colors.label,
                    fontSize: 22,
                    fontWeight: "800",
                    textAlign: "center",
                  }}
                >
                  {currentStep.title}
                </Text>
                <View style={{ gap: 12, maxWidth: 420, width: "100%" }}>
                  {bodyParagraphs.map((paragraph) => (
                    <Text
                      key={`${currentStepKey}-${paragraph}`}
                      selectable
                      style={{
                        color:
                          paragraph === bodyParagraphs[0] ? colors.label : colors.secondaryLabel,
                        fontSize: 16,
                        fontWeight: paragraph === bodyParagraphs[0] ? "600" : "400",
                        lineHeight: 24,
                        textAlign: "center",
                      }}
                    >
                      {paragraph}
                    </Text>
                  ))}
                </View>
                {currentStep.note ? (
                  <View
                    style={{
                      alignItems: "flex-start",
                      alignSelf: "center",
                      flexDirection: "row",
                      gap: 8,
                      maxWidth: 420,
                      width: "100%",
                    }}
                  >
                    <View style={{ height: 18, marginTop: 3, width: 18 }}>
                      <SymbolView
                        accessible={false}
                        name="questionmark.circle"
                        size={18}
                        tintColor={colors.tertiaryLabel}
                      />
                    </View>
                    <Text
                      selectable
                      style={{
                        color: colors.secondaryLabel,
                        flex: 1,
                        fontSize: 15,
                        lineHeight: 22,
                      }}
                    >
                      {currentStep.note}
                    </Text>
                  </View>
                ) : null}
              </Animated.View>
            </ScrollView>
          </View>
        </View>
        <View
          style={{
            backgroundColor: colors.background,
            gap: 4,
            paddingBottom: Math.max(bottomInset, 12),
            paddingHorizontal: 24,
            paddingTop: 4,
          }}
        >
          <Pressable
            accessibilityLabel={t("queueHowItWorksSkip")}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void haptic("light");
              onDismiss();
            }}
            style={({ pressed }) => ({
              alignItems: "center",
              alignSelf: "center",
              justifyContent: "center",
              minHeight: 44,
              opacity: pressed ? 0.6 : 1,
              paddingHorizontal: 12,
            })}
          >
            <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "600" }}>
              {t("queueHowItWorksSkip")}
            </Text>
          </Pressable>
          <View
            style={{
              alignSelf: "center",
              flexDirection: stackFooterActions ? "column" : "row",
              gap: 10,
              maxWidth: 560,
              width: "100%",
            }}
          >
            <ActionButton
              disabled={stepIndex === 0}
              haptic={false}
              icon="chevron.left"
              label={t("queueHowItWorksBack")}
              onPress={goBack}
              style={stackFooterActions ? { width: "100%" } : { flex: 1 }}
              variant="outlined"
            />
            <ActionButton
              haptic={false}
              icon={stepIndex === steps.length - 1 ? "checkmark.circle.fill" : "chevron.right"}
              label={
                stepIndex === steps.length - 1 ? t("queueHowItWorksDone") : t("queueHowItWorksNext")
              }
              onPress={advance}
              style={stackFooterActions ? { width: "100%" } : { flex: 1 }}
              variant="filled"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function combineCleanups(cleanups: Array<() => void>) {
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

const QueueCard = memo(function QueueCard({
  item,
  precalled,
}: {
  item: QueueEntry;
  precalled: boolean;
}) {
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
});

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
