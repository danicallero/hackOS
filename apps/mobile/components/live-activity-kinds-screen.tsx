import type {
  LiveActivityConfigKind,
  MyLiveActivityPreferences,
} from "@hackos/shared/live-activities";
import { useEffect, useState } from "react";
import {
  type AccessibilityActionEvent,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ActionButton, Section, SWITCH_IN_ROW_STYLE } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useLiveActivityKinds } from "@/lib/live-activities/use-live-activity-kinds";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { colors } from "@/theme/colors";

type KindPreference = MyLiveActivityPreferences["kinds"][number];
type Slots = Record<string, number>;

export const LIVE_ACTIVITY_KIND_LABEL = {
  activity: "liveActivityKindActivity",
  attendee_activity: "liveActivityKindAttendeeActivity",
  queue: "liveActivityKindQueue",
  deadline: "liveActivityKindDeadline",
  accreditation: "liveActivityKindAccreditation",
} as const satisfies Record<LiveActivityConfigKind, string>;

/** `order` with `kind` moved `delta` places (clamped to the list). */
export function moveKind(
  order: readonly LiveActivityConfigKind[],
  kind: LiveActivityConfigKind,
  delta: number,
): LiveActivityConfigKind[] {
  const from = order.indexOf(kind);
  const to = Math.min(order.length - 1, Math.max(0, from + delta));
  const next = order.filter((item) => item !== kind);
  next.splice(to, 0, kind);
  return next;
}

function slotsOf(order: readonly LiveActivityConfigKind[]): Slots {
  return Object.fromEntries(order.map((kind, index) => [kind, index]));
}

/** Every row has the same height so a drag maps to a slot by division. */
function useRowHeight() {
  const { fontScale } = useWindowDimensions();
  return Math.round(50 * Math.max(1, fontScale));
}

/**
 * #966 (H38, H25, H59, H19, H22): Notifications → Live Activities. The kinds
 * this account receives, each with its switch, in the person's own priority
 * order: drag a row's handle (or use the VoiceOver move actions) to decide
 * which kinds take the device's few slots first.
 */
export function LiveActivityKindsScreen() {
  const { t } = useLocale();
  const kinds = useLiveActivityKinds(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();

  async function onRefresh() {
    setRefreshing(true);
    try {
      await kinds.load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        gap: 20,
        padding: 16,
        paddingBottom: Math.max(32, tabBarBottomInset + 16),
      }}
      scrollEnabled={!dragging}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      {kinds.kinds.length > 0 ? (
        <Section footer={kinds.kinds.length > 1 ? t("liveActivityOrderFooter") : undefined}>
          <KindOrderList
            kinds={kinds.kinds}
            busyKind={kinds.busyKind}
            onToggle={(kind, enabled) => void kinds.toggle(kind, enabled)}
            onReorder={(order) => void kinds.reorder(order)}
            onDragging={setDragging}
          />
        </Section>
      ) : null}
      {kinds.customOrder ? (
        <Section>
          <ActionButton
            label={t("liveActivityResetOrder")}
            busy={kinds.ordering}
            onPress={() => void kinds.resetOrder()}
          />
        </Section>
      ) : null}
    </ScrollView>
  );
}

function KindOrderList({
  kinds,
  busyKind,
  onToggle,
  onReorder,
  onDragging,
}: {
  kinds: KindPreference[];
  busyKind: LiveActivityConfigKind | null;
  onToggle: (kind: LiveActivityConfigKind, enabled: boolean) => void;
  onReorder: (order: LiveActivityConfigKind[]) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const height = useRowHeight();
  const order = kinds.map((item) => item.kind);
  const orderKey = order.join(",");
  const slots = useSharedValue<Slots>(slotsOf(order));
  const active = useSharedValue<string | null>(null);

  // A saved (or rolled back) order moves the rows to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: orderKey is the order's identity.
  useEffect(() => {
    slots.value = slotsOf(order);
  }, [orderKey, slots]);

  function drop(final: Slots) {
    onDragging(false);
    const next = [...order].sort((a, b) => (final[a] ?? 0) - (final[b] ?? 0));
    if (next.join(",") !== orderKey) onReorder(next);
  }

  return (
    <View style={{ height: height * kinds.length }}>
      {kinds.map(({ kind, enabled }, index) => (
        <KindRow
          key={kind}
          kind={kind}
          index={index}
          enabled={enabled}
          busy={busyKind === kind}
          count={kinds.length}
          height={height}
          slots={slots}
          active={active}
          onToggle={(next) => onToggle(kind, next)}
          onMove={(delta) => onReorder(moveKind(order, kind, delta))}
          onDragStart={() => onDragging(true)}
          onDrop={drop}
        />
      ))}
    </View>
  );
}

function KindRow({
  kind,
  index,
  enabled,
  busy,
  count,
  height,
  slots,
  active,
  onToggle,
  onMove,
  onDragStart,
  onDrop,
}: {
  kind: LiveActivityConfigKind;
  /** Saved position; `slots` also tracks it live during a drag. */
  index: number;
  enabled: boolean;
  busy: boolean;
  count: number;
  height: number;
  slots: SharedValue<Slots>;
  active: SharedValue<string | null>;
  onToggle: (enabled: boolean) => void;
  onMove: (delta: number) => void;
  onDragStart: () => void;
  onDrop: (slots: Slots) => void;
}) {
  const { t } = useLocale();
  const reducedMotion = useReducedMotion();
  const label = t(LIVE_ACTIVITY_KIND_LABEL[kind]);
  const top = useSharedValue(index * height);
  const startTop = useSharedValue(0);
  const duration = reducedMotion ? 0 : 180;

  // Neighbours slide into the slot the dragged row leaves.
  useAnimatedReaction(
    () => slots.value[kind] ?? 0,
    (next) => {
      if (active.value !== kind) top.value = withTiming(next * height, { duration });
    },
    [height, duration],
  );

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin(() => {
      active.value = kind;
      startTop.value = top.value;
      runOnJS(onDragStart)();
      runOnJS(haptic)("light");
    })
    .onUpdate((event) => {
      const y = Math.min((count - 1) * height, Math.max(0, startTop.value + event.translationY));
      top.value = y;
      const from = slots.value[kind] ?? 0;
      const to = Math.round(y / height);
      if (to === from) return;
      const next: Slots = {};
      for (const [other, position] of Object.entries(slots.value)) {
        if (other === kind) next[other] = to;
        else if (from < to && position > from && position <= to) next[other] = position - 1;
        else if (to < from && position >= to && position < from) next[other] = position + 1;
        else next[other] = position;
      }
      slots.value = next;
      runOnJS(haptic)("selection");
    })
    .onFinalize(() => {
      top.value = withTiming((slots.value[kind] ?? 0) * height, { duration });
      active.value = null;
      runOnJS(onDrop)(slots.value);
    });

  const rowStyle = useAnimatedStyle(() => {
    const lifted = active.value === kind;
    return {
      transform: [{ translateY: top.value }],
      zIndex: lifted ? 1 : 0,
      shadowOpacity: withTiming(lifted ? 0.18 : 0, { duration }),
    };
  });
  const separatorStyle = useAnimatedStyle(() => ({
    opacity: (slots.value[kind] ?? 0) > 0 && active.value === null ? 1 : 0,
  }));

  function onAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === "moveUp") onMove(-1);
    if (event.nativeEvent.actionName === "moveDown") onMove(1);
  }

  return (
    <Animated.View
      style={[
        {
          backgroundColor: colors.surface,
          height,
          left: 0,
          position: "absolute",
          right: 0,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 12,
          top: 0,
        },
        rowStyle,
      ]}
    >
      <Animated.View
        style={[{ backgroundColor: colors.separator, height: 0.5, marginLeft: 16 }, separatorStyle]}
      />
      <View style={{ alignItems: "center", flex: 1, flexDirection: "row", paddingLeft: 16 }}>
        <Text numberOfLines={2} style={{ color: colors.label, flex: 1, fontSize: 16 }}>
          {label}
        </Text>
        <Switch
          accessibilityLabel={label}
          disabled={busy}
          onValueChange={onToggle}
          style={[SWITCH_IN_ROW_STYLE, { marginLeft: 12 }]}
          value={enabled}
        />
        <GestureDetector gesture={pan}>
          <View
            accessible
            accessibilityLabel={t("liveActivityReorder", { kind: label })}
            accessibilityValue={{
              text: t("liveActivityOrderPosition", {
                position: String(index + 1),
                total: String(count),
              }),
            }}
            accessibilityActions={[
              ...(index > 0 ? [{ name: "moveUp", label: t("liveActivityMoveUp") }] : []),
              ...(index < count - 1
                ? [{ name: "moveDown", label: t("liveActivityMoveDown") }]
                : []),
            ]}
            onAccessibilityAction={onAccessibilityAction}
            style={{
              alignItems: "center",
              alignSelf: "stretch",
              justifyContent: "center",
              width: 52,
            }}
          >
            <SymbolView
              name="line.3.horizontal"
              tintColor={colors.tertiaryLabel}
              size={18}
              accessible={false}
            />
          </View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}
