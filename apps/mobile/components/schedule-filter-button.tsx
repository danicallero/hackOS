import { Modal, Pressable, Text, View } from "react-native";
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
 * Icon-only trigger (H59 3b), meant to sit as one of the touch zones inside a
 * shared glass pill (schedule.tsx combines it with the notifications bell) —
 * open/close state is controlled by the caller so the dropdown panel below
 * can be positioned outside that pill instead of clipped inside it.
 */
export function ScheduleFilterTrigger({
  open,
  onToggle,
  active,
}: {
  open: boolean;
  onToggle: () => void;
  active: boolean;
}) {
  const { t } = useLocale();
  const icon = active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease";

  return (
    <Pressable
      accessibilityLabel={t("scheduleFilter")}
      accessibilityRole="button"
      accessibilityState={{ expanded: open, selected: active }}
      onPress={() => {
        void haptic("light");
        onToggle();
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 44,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
        width: 44,
      })}
    >
      <SymbolView
        name={icon}
        tintColor={active ? colors.accent : colors.label}
        size={19}
        weight="semibold"
      />
    </Pressable>
  );
}

/** Screen coordinates of the trigger, captured via `measureInWindow` — see {@link ScheduleFilterPanel}. */
export interface ScheduleFilterAnchor {
  top: number;
  right: number;
}

/**
 * Backdrop + dropdown content for {@link ScheduleFilterTrigger}, rendered in
 * a `Modal` rather than as an absolutely-positioned sibling: the trigger now
 * sits inside a native header (`headerRight`) or a Liquid Glass pill, both of
 * which clip overflowing content to their own bounds, so a plain in-tree
 * absolute View would get cut off. A Modal always draws in its own native
 * layer regardless of where it's triggered from. `anchor` is the trigger's
 * on-screen frame (from `measureInWindow`) so the panel still opens right
 * under it. Kind multi-select is open to everyone; audience multi-select is
 * shown only to callers with SCHEDULE_MANAGE. Both dimensions AND together.
 */
export function ScheduleFilterPanel({
  open,
  anchor,
  onClose,
  kinds,
  selectedKinds,
  onToggleKind,
  showAudience,
  selectedAudiences,
  onToggleAudience,
  onClear,
}: {
  open: boolean;
  anchor: ScheduleFilterAnchor | null;
  onClose: () => void;
  kinds: string[];
  selectedKinds: string[];
  onToggleKind: (kind: string) => void;
  showAudience: boolean;
  selectedAudiences: AudienceFilterValue[];
  onToggleAudience: (audience: AudienceFilterValue) => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const active = selectedKinds.length > 0 || selectedAudiences.length > 0;

  if (!open || !anchor) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ flex: 1 }}
      >
        <View
          style={{
            position: "absolute",
            right: anchor.right,
            top: anchor.top,
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
                <Text
                  style={{
                    color: colors.accent,
                    fontSize: 15,
                    fontWeight: "600",
                  }}
                >
                  {t("scheduleFilterClear")}
                </Text>
              </Pressable>
            ) : null}
          </GlassView>
        </View>
      </Pressable>
    </Modal>
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
