import { FilterMenu, type FilterMenuProps } from "@/components/filter-menu";
import { useLocale } from "@/lib/i18n";
import { SCHEDULE_AUDIENCES, type ScheduleAudience, scheduleTypeLabel } from "@/lib/schedule";

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

/** Schedule kind and audience multi-select share the persistent filter menu (H59). */
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
  const active = selectedKinds.length > 0 || selectedAudiences.length > 0;
  const items: FilterMenuProps["items"] = kinds.map((kind) => ({
    id: `kind:${kind}`,
    label: scheduleTypeLabel(kind, t),
    selected: selectedKinds.includes(kind),
    section: t("scheduleFilterKind"),
  }));
  if (showAudience) {
    items.push(
      ...AUDIENCE_FILTER_VALUES.map((audience) => ({
        id: `audience:${audience}`,
        label: audienceFilterLabel(audience, t),
        selected: selectedAudiences.includes(audience),
        section: t("scheduleFilterAudience"),
      })),
    );
  }
  if (active) {
    items.push({ id: "clear", label: t("scheduleFilterClear"), selected: false });
  }

  return (
    <FilterMenu
      accessibilityLabel={t("scheduleFilter")}
      active={active}
      items={items}
      onSelect={(id) => {
        if (id === "clear") onClear();
        else if (id.startsWith("kind:")) onToggleKind(id.slice(5));
        else if (showAudience && id.startsWith("audience:")) {
          const audience = AUDIENCE_FILTER_VALUES.find((value) => id === `audience:${value}`);
          if (audience) onToggleAudience(audience);
        }
      }}
    />
  );
}
