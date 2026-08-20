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
                        {manualCount > 0 ? (
                          <Text style={{ color: colors.secondaryLabel, fontSize: 12 }}>
                            {[
                              subscribed.length > 0
                                ? t("scheduleManualSubscribedCount", {
                                    count: String(subscribed.length),
                                  })
                                : null,
                              muted.length > 0
                                ? t("scheduleManualMutedCount", { count: String(muted.length) })
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
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
                      {subscribed.length > 0 ? (
                        <Text style={manualGroupLabelStyle}>{t("scheduleManualSubscribed")}</Text>
                      ) : null}
                      {subscribed.map((item, entryIndex) => (
                        <ManualEntryRow
                          key={item.id}
                          item={item}
                          muted={false}
                          divider={entryIndex > 0}
                          busy={savingKind === itemCategory(item.id)}
                          onPress={() => onToggleEntry(item)}
                        />
                      ))}
                      {muted.length > 0 ? (
                        <Text style={manualGroupLabelStyle}>{t("scheduleManualMuted")}</Text>
                      ) : null}
                      {muted.map((item, entryIndex) => (
                        <ManualEntryRow
                          key={item.id}
                          item={item}
                          muted
                          divider={entryIndex > 0}
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

const manualGroupLabelStyle = {
  color: colors.tertiaryLabel,
  fontSize: 11,
  fontWeight: "600" as const,
  letterSpacing: 0.3,
  paddingHorizontal: 16,
  paddingTop: 10,
  textTransform: "uppercase" as const,
};

function ManualEntryRow({
  item,
  muted,
  divider,
  busy,
  onPress,
}: {
  item: ScheduleItem;
  muted: boolean;
  divider: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const { t } = useLocale();
  return (
    <Pressable
      accessibilityLabel={`${item.title} — ${t(muted ? "scheduleManualMuted" : "scheduleManualSubscribed")}`}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        borderTopColor: colors.separator,
        borderTopWidth: divider ? 0.5 : 0,
        flexDirection: "row",
        gap: 10,
        minHeight: 44,
        marginTop: divider ? 0 : 4,
        opacity: busy ? 0.4 : pressed ? 0.6 : 1,
        paddingHorizontal: 16,
        paddingVertical: 8,
      })}
    >
      <SymbolView
        name={muted ? "bell.slash.fill" : "bell.fill"}
        tintColor={muted ? colors.tertiaryLabel : colors.accent}
        size={14}
      />
      <Text
        selectable={false}
        numberOfLines={1}
        style={{ color: colors.secondaryLabel, flex: 1, fontSize: 15 }}
      >
        {item.title}
      </Text>
      <SymbolView name="xmark.circle.fill" tintColor={colors.tertiaryLabel} size={16} />
    </Pressable>
  );
}
