import { Modal, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingGlassButton } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { scheduleTypeLabel } from "@/lib/schedule";
import type { CategoryState } from "@/lib/use-schedule-notifications";
import { colors } from "@/theme/colors";

/**
 * H59 category notification settings sheet — one toggle per activity kind
 * present in the current schedule, reflecting on/off/partial (a kind that's
 * subscribed but has one or more individually-muted entries).
 */
export function ScheduleNotificationsSheet({
  visible,
  onClose,
  kinds,
  categoryState,
  onToggleCategory,
  savingKind,
}: {
  visible: boolean;
  onClose: () => void;
  kinds: string[];
  categoryState: (kind: string) => CategoryState;
  onToggleCategory: (kind: string, enabled: boolean) => void;
  savingKind: string | null;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();

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
              paddingHorizontal: 16,
            }}
          >
            {kinds.map((kind, index) => {
              const state = categoryState(kind);
              return (
                <View
                  key={kind}
                  style={{
                    alignItems: "center",
                    borderBottomColor: colors.separator,
                    borderBottomWidth: index === kinds.length - 1 ? 0 : 0.5,
                    flexDirection: "row",
                    gap: 8,
                    paddingVertical: 12,
                  }}
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
                  <Switch
                    disabled={savingKind === kind}
                    onValueChange={(next) => onToggleCategory(kind, next)}
                    value={state !== "off"}
                  />
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
