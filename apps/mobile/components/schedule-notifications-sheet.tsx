import { useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingGlassButton } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import type { ScheduleItem } from "@/lib/schedule";
import { scheduleTypeLabel } from "@/lib/schedule";
import { type CategoryState, itemCategory, kindCategory } from "@/lib/use-schedule-notifications";
import { colors } from "@/theme/colors";

/**
 * H59 category notification settings sheet — one row per activity kind
 * present in the current schedule, with a live notified/muted count and a
 * toggle for the whole category. Tapping a row (off the toggle) drills into
 * that kind's full activity list, each with its own toggle, instead of
 * only surfacing the manual overrides.
 */
export function ScheduleNotificationsSheet({
  visible,
  onClose,
  kinds,
  items,
  categoryState,
  onToggleCategory,
  isEntrySubscribed,
  onToggleEntry,
  savingKey,
}: {
  visible: boolean;
  onClose: () => void;
  kinds: string[];
  items: ScheduleItem[];
  categoryState: (kind: string) => CategoryState;
  onToggleCategory: (kind: string, enabled: boolean) => void;
  isEntrySubscribed: (item: ScheduleItem) => boolean;
  onToggleEntry: (item: ScheduleItem) => void;
  savingKey: string | null;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [viewingKind, setViewingKind] = useState<string | null>(null);

  function close() {
    setViewingKind(null);
    onClose();
  }

  // Edge-swipe-right-to-go-back, matching iOS's native pop gesture.
  // failOffsetY defers to the ScrollView on a mostly-vertical drag.
  const backGesture = Gesture.Pan()
    .enabled(viewingKind !== null)
    .activeOffsetX(20)
    .failOffsetY([-15, 15])
    .onEnd((event) => {
      if (event.translationX > 70) runOnJS(setViewingKind)(null);
    });

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <GestureDetector gesture={backGesture}>
        <View style={{ backgroundColor: colors.background, flex: 1 }}>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              paddingBottom: Math.max(32, insets.bottom + 16),
              paddingTop: 16,
            }}
          >
            {viewingKind ? (
              <Animated.View
                key={viewingKind}
                entering={SlideInRight}
                exiting={SlideOutRight}
                style={{ gap: 22, paddingHorizontal: 16 }}
              >
                <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 36 }}>
                  <Text
                    selectable
                    style={{
                      color: colors.label,
                      fontSize: 20,
                      fontWeight: "700",
                      textAlign: "center",
                    }}
                  >
                    {scheduleTypeLabel(viewingKind, t)}
                  </Text>
                </View>
                <KindEntryList
                  items={items.filter((item) => item.type === viewingKind)}
                  isEntrySubscribed={isEntrySubscribed}
                  onToggleEntry={onToggleEntry}
                  savingKey={savingKey}
                />
              </Animated.View>
            ) : (
              <Animated.View
                key="root"
                entering={SlideInLeft}
                exiting={SlideOutLeft}
                style={{ gap: 22, paddingHorizontal: 16 }}
              >
                <View style={{ gap: 4, paddingHorizontal: 36 }}>
                  <Text
                    selectable
                    style={{
                      color: colors.label,
                      fontSize: 20,
                      fontWeight: "700",
                      textAlign: "center",
                    }}
                  >
                    {t("scheduleNotificationsTitle")}
                  </Text>
                  <Text style={{ color: colors.secondaryLabel, fontSize: 13, textAlign: "center" }}>
                    {t("scheduleNotificationsSubtitle")}
                  </Text>
                </View>

                <View
                  style={{
                    backgroundColor: colors.surface,
                    borderCurve: "continuous",
                    borderRadius: 14,
                    overflow: "hidden",
                  }}
                >
                  {kinds.map((kind, index) => {
                    const state = categoryState(kind);
                    const kindItems = items.filter((item) => item.type === kind);
                    const notifiedCount = kindItems.filter(isEntrySubscribed).length;
                    const mutedCount = kindItems.length - notifiedCount;
                    return (
                      <View
                        key={kind}
                        style={{
                          alignItems: "center",
                          borderBottomColor: colors.separator,
                          borderBottomWidth: index === kinds.length - 1 ? 0 : 0.5,
                          flexDirection: "row",
                          gap: 8,
                          paddingHorizontal: 16,
                          paddingVertical: 12,
                        }}
                      >
                        <Pressable
                          accessibilityLabel={scheduleTypeLabel(kind, t)}
                          accessibilityRole="button"
                          onPress={() => setViewingKind(kind)}
                          style={{ flex: 1, gap: 2 }}
                        >
                          <Text style={{ color: colors.label, fontSize: 16 }}>
                            {scheduleTypeLabel(kind, t)}
                          </Text>
                          <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>
                            {t("scheduleManualSubscribedCount", { count: String(notifiedCount) })} ·{" "}
                            {t("scheduleManualMutedCount", { count: String(mutedCount) })}
                          </Text>
                        </Pressable>
                        <Switch
                          disabled={savingKey === kindCategory(kind)}
                          onValueChange={(next) => onToggleCategory(kind, next)}
                          value={state !== "off"}
                        />
                        <Pressable
                          accessibilityLabel={scheduleTypeLabel(kind, t)}
                          accessibilityRole="button"
                          onPress={() => setViewingKind(kind)}
                          hitSlop={8}
                        >
                          <SymbolView
                            name="chevron.right"
                            tintColor={colors.tertiaryLabel}
                            size={14}
                          />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </Animated.View>
            )}
          </ScrollView>

          <FloatingGlassButton
            top={16}
            side="left"
            icon={viewingKind ? "chevron.left" : "xmark"}
            accessibilityLabel={viewingKind ? t("back") : t("close")}
            onPress={() => (viewingKind ? setViewingKind(null) : close())}
          />
        </View>
      </GestureDetector>
    </Modal>
  );
}

function KindEntryList({
  items,
  isEntrySubscribed,
  onToggleEntry,
  savingKey,
}: {
  items: ScheduleItem[];
  isEntrySubscribed: (item: ScheduleItem) => boolean;
  onToggleEntry: (item: ScheduleItem) => void;
  savingKey: string | null;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {items.map((item, index) => (
        <View
          key={item.id}
          style={{
            alignItems: "center",
            borderBottomColor: colors.separator,
            borderBottomWidth: index === items.length - 1 ? 0 : 0.5,
            flexDirection: "row",
            gap: 8,
            minHeight: 50,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          <Text selectable numberOfLines={2} style={{ color: colors.label, flex: 1, fontSize: 15 }}>
            {item.title}
          </Text>
          <Switch
            disabled={savingKey === itemCategory(item.id)}
            onValueChange={() => onToggleEntry(item)}
            value={isEntrySubscribed(item)}
          />
        </View>
      ))}
    </View>
  );
}
