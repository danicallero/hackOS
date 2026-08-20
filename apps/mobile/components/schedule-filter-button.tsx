import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { GlassView } from "@/components/glass-view";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { SCHEDULE_AUDIENCES, type ScheduleAudience, scheduleTypeLabel } from "@/lib/schedule";
import { colors } from "@/theme/colors";

const FILTER_PANEL_Z_INDEX = 1000;

/** "staff" is a client-side pseudo-audience meaning "this item's `audiences` array is empty". */
export type AudienceFilterValue = ScheduleAudience | "staff";
const AUDIENCE_FILTER_VALUES: AudienceFilterValue[] = [...SCHEDULE_AUDIENCES, "staff"];

function audienceFilterLabel(audience: AudienceFilterValue, t: ReturnType<typeof useLocale>["t"]) {
  switch (audience) {
    case "participant":
      return t("scheduleAudienceParticipant");
    case "sponsor":
      return t("scheduleAudienceSponsor");
    case "mentor":
      return t("scheduleAudienceMentor");
    case "staff":
      return t("scheduleAudienceStaff");
  }
}

/**
 * Glass filter button (H59 3b) — kind multi-select for everyone, plus an
 * audience multi-select only shown to callers with SCHEDULE_MANAGE. Both
 * dimensions AND together; reuses the scanner screen's glass dropdown look.
 */
export function ScheduleFilterButton({
  kinds,
  selectedKinds,
  onToggleKind,
  showAudience,
  selectedAudiences,
  onToggleAudience,
  onClear,
}: {
  kinds: string[];
  selectedKinds: string[];
  onToggleKind: (kind: string) => void;
  showAudience: boolean;
  selectedAudiences: AudienceFilterValue[];
  onToggleAudience: (audience: AudienceFilterValue) => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const active = selectedKinds.length > 0 || selectedAudiences.length > 0;
  const icon = active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease";

  return (
    <>
      {open ? (
        <Pressable
          accessibilityLabel={t("close")}
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
        />
      ) : null}
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        style={{ borderRadius: 22, height: 44, width: 44, zIndex: FILTER_PANEL_Z_INDEX + 1 }}
      >
        <Pressable
          accessibilityLabel={t("scheduleFilter")}
          accessibilityRole="button"
          accessibilityState={{ expanded: open, selected: active }}
          onPress={() => {
            void haptic("light");
            setOpen((current) => !current);
          }}
          style={{ alignItems: "center", flex: 1, justifyContent: "center" }}
        >
          <SymbolView name={icon} tintColor="white" size={19} weight="semibold" />
        </Pressable>
      </GlassView>
      {open ? (
        <View
          style={{
            position: "absolute",
            right: 0,
            top: 52,
            width: 240,
            zIndex: FILTER_PANEL_Z_INDEX + 1,
          }}
        >
          <GlassView
            colorScheme="dark"
            glassEffectStyle="regular"
            style={{
              borderColor: "rgba(255,255,255,0.14)",
              borderCurve: "continuous",
              borderRadius: 18,
              borderWidth: 0.5,
              elevation: 12,
              overflow: "hidden",
              shadowColor: "#000",
              shadowOffset: { height: 6, width: 0 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
            }}
          >
            <FilterSectionLabel label={t("scheduleFilterKind")} />
            {kinds.map((kind) => (
              <FilterRow
                key={kind}
                label={scheduleTypeLabel(kind, t)}
                selected={selectedKinds.includes(kind)}
                onPress={() => onToggleKind(kind)}
              />
            ))}
            {showAudience ? (
              <>
                <FilterSectionLabel label={t("scheduleFilterAudience")} />
                {AUDIENCE_FILTER_VALUES.map((audience) => (
                  <FilterRow
                    key={audience}
                    label={audienceFilterLabel(audience, t)}
                    selected={selectedAudiences.includes(audience)}
                    onPress={() => onToggleAudience(audience)}
                  />
                ))}
              </>
            ) : null}
            {active ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void haptic("selection");
                  onClear();
                }}
                style={{
                  borderTopColor: "rgba(255,255,255,0.12)",
                  borderTopWidth: 0.5,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <Text style={{ color: colors.accent, fontSize: 15, fontWeight: "600" }}>
                  {t("scheduleFilterClear")}
                </Text>
              </Pressable>
            ) : null}
          </GlassView>
        </View>
      ) : null}
    </>
  );
}

function FilterSectionLabel({ label }: { label: string }) {
  return (
    <Text
      style={{
        color: "rgba(255,255,255,0.6)",
        fontSize: 12,
        fontWeight: "600",
        paddingHorizontal: 14,
        paddingTop: 12,
        textTransform: "uppercase",
      }}
    >
      {label}
    </Text>
  );
}

function FilterRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        void haptic("selection");
        onPress();
      }}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Text selectable={false} style={{ color: "white", flex: 1, fontSize: 15 }}>
        {label}
      </Text>
      {selected ? (
        <SymbolView
          accessible={false}
          name="checkmark"
          tintColor={colors.accent}
          size={15}
          weight="bold"
        />
      ) : null}
    </Pressable>
  );
}
