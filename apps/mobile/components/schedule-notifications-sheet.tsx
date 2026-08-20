import { useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingGlassButton } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import type { ScheduleItem } from "@/lib/schedule";
import { scheduleTypeLabel } from "@/lib/schedule";
import { type CategoryState, itemCategory, kindCategory } from "@/lib/use-schedule-notifications";
import { colors } from "@/theme/colors";

/**
 * H59 category notification settings sheet — one toggle per activity kind
 * present in the current schedule, reflecting on/off/partial (a kind that's
 * subscribed but has one or more individually-muted entries). Expanding a
 * kind lists the manual overrides behind that state — entries individually
 * subscribed while the kind is off, or muted while the kind is on — each
 * reversible from here too, not just from the entry's own bell.
 */
export function ScheduleNotificationsSheet({
  visible,
  onClose,
  kinds,
  categoryState,
  onToggleCategory,
  manualEntries,
  onToggleEntry,
  savingKind,
}: {
  visible: boolean;
  onClose: () => void;
  kinds: string[];
  categoryState: (kind: string) => CategoryState;
  onToggleCategory: (kind: string, enabled: boolean) => void;
  manualEntries: (kind: string) => { subscribed: ScheduleItem[]; muted: ScheduleItem[] };
  onToggleEntry: (item: ScheduleItem) => void;
  savingKind: string | null;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            gap: 22,
            padding: 16,
            paddingBottom: Math.max(32, insets.bottom + 16),
            paddingTop: 16,
          }}
        >
          <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
            <Text
              selectable
              style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
            >
              {t("scheduleNotificationsTitle")}
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
              const { subscribed, muted } = manualEntries(kind);
              const manualCount = subscribed.length + muted.length;
              const isExpanded = expanded === kind;
              return (
                <View
                  key={kind}
                  style={{
                    borderBottomColor: colors.separator,
                    borderBottomWidth: index === kinds.length - 1 ? 0 : 0.5,
                  }}
                >
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      gap: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                    }}
                  >
                    <Pressable
                      accessibilityLabel={scheduleTypeLabel(kind, t)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isExpanded, disabled: manualCount === 0 }}
                      disabled={manualCount === 0}
                      onPress={() => setExpanded((current) => (current === kind ? null : kind))}
                      style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 6 }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.label, fontSize: 16 }}>
                          {scheduleTypeLabel(kind, t)}
                        </Text>
                        {state === "partial" ? (
                          <View style={{ alignItems: "center", flexDirection: "row", gap: 4 }}>
                            <SymbolView
                              name="minus.circle.fill"
                              tintColor={colors.secondaryLabel}
                              size={12}
                            />
                            <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>
                              {t("scheduleNotificationsPartial")}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {manualCount > 0 ? (
                        <SymbolView
                          name={isExpanded ? "chevron.up" : "chevron.down"}
                          tintColor={colors.tertiaryLabel}
                          size={13}
                        />
                      ) : null}
                    </Pressable>
                    <Switch
                      disabled={savingKind === kindCategory(kind)}
                      onValueChange={(next) => onToggleCategory(kind, next)}
                      value={state !== "off"}
                    />
                  </View>
                  {isExpanded ? (
                    <View style={{ paddingBottom: 8 }}>
                      {subscribed.map((item) => (
                        <ManualEntryRow
                          key={item.id}
                          item={item}
                          label={t("scheduleManualSubscribed")}
                          busy={savingKind === itemCategory(item.id)}
                          onPress={() => onToggleEntry(item)}
                        />
                      ))}
                      {muted.map((item) => (
                        <ManualEntryRow
                          key={item.id}
                          item={item}
                          label={t("scheduleManualMuted")}
                          busy={savingKind === itemCategory(item.id)}
                          onPress={() => onToggleEntry(item)}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </ScrollView>

        <FloatingGlassButton
          top={16}
          side="left"
          icon="xmark"
          accessibilityLabel={t("close")}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}

function ManualEntryRow({
  item,
  label,
  busy,
  onPress,
}: {
  item: ScheduleItem;
  label: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${item.title} — ${label}`}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        flexDirection: "row",
        gap: 8,
        opacity: busy ? 0.4 : pressed ? 0.6 : 1,
        paddingHorizontal: 32,
        paddingVertical: 8,
      })}
    >
      <Text
        selectable={false}
        numberOfLines={1}
        style={{ color: colors.label, flex: 1, fontSize: 14 }}
      >
        {item.title}
      </Text>
      <Text selectable={false} style={{ color: colors.secondaryLabel, fontSize: 12 }}>
        {label}
      </Text>
    </Pressable>
  );
}
