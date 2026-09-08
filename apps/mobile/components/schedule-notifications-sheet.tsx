import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, SlideInLeft, SlideInRight } from "react-native-reanimated";
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
  // Android presents this as a full-screen modal rather than an iOS page
  // sheet, so the scroll content must clear the status bar itself.
  const sheetTopInset = Platform.OS === "android" ? insets.top : 0;
  const [viewingKind, setViewingKind] = useState<string | null>(null);
  const [hasViewedDetail, setHasViewedDetail] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setViewingKind(null);
    setHasViewedDetail(false);
  }, [visible]);

  function close() {
    onClose();
  }

  function openKind(kind: string) {
    setHasViewedDetail(true);
    setViewingKind(kind);
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
          <View
            style={{
              backgroundColor: colors.background,
              left: 0,
              minHeight: (viewingKind ? 60 : 86) + sheetTopInset,
              paddingHorizontal: 52,
              paddingTop: sheetTopInset + 16,
              position: "absolute",
              right: 0,
              shadowColor: "#000000",
              shadowOffset: { height: 2, width: 0 },
              shadowOpacity: 0.08,
              shadowRadius: 6,
              top: 0,
              zIndex: 2,
            }}
          >
            <Text
              ellipsizeMode="tail"
              numberOfLines={1}
              selectable
              style={{
                color: colors.label,
                fontSize: 20,
                fontWeight: "700",
                lineHeight: 26,
                textAlign: "center",
              }}
            >
              {viewingKind ? scheduleTypeLabel(viewingKind, t) : t("scheduleNotificationsTitle")}
            </Text>
            {!viewingKind ? (
              <Text
                ellipsizeMode="tail"
                numberOfLines={1}
                style={{ color: colors.secondaryLabel, fontSize: 13, textAlign: "center" }}
              >
                {t("scheduleNotificationsSubtitle")}
              </Text>
            ) : null}
          </View>
          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={{
              paddingBottom: Math.max(32, insets.bottom + 16),
              paddingTop: (viewingKind ? 76 : 102) + sheetTopInset,
            }}
          >
            {viewingKind ? (
              <Animated.View
                key={viewingKind}
                entering={SlideInRight}
                style={{ gap: 22, paddingHorizontal: 16 }}
              >
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
                entering={hasViewedDetail ? SlideInLeft : undefined}
                style={{ gap: 22, paddingHorizontal: 16 }}
              >
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
                          onPress={() => openKind(kind)}
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
                          onPress={() => openKind(kind)}
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
            // `presentationStyle="pageSheet"` is iOS-only; on Android the Modal
            // renders edge-to-edge under the status bar, so the close button
            // needs the safe-area top inset added on top of the base offset
            // to avoid crowding the status bar / notch (#481).
            top={Platform.OS === "android" ? insets.top + 16 : 16}
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
