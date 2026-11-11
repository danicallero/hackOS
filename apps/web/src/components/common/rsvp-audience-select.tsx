"use client";

import { MultiSelect } from "@/components/common/multi-select";
import { useAudienceRoles } from "@/hooks/use-audience-roles";
import { useLocale } from "@/lib/i18n";

/**
 * Who an RSVP is asked of (H59): the publicly visible roles, in a dropdown like
 * the schedule audience's. Holding any chosen role is enough to be asked.
 */
export function RsvpAudienceSelect({
  id,
  value,
  onChange,
  inDialog = false,
}: {
  id: string;
  value: number[];
  onChange: (roleIds: number[]) => void;
  inDialog?: boolean;
}) {
  const { t } = useLocale();
  const { roles } = useAudienceRoles();
  return (
    <MultiSelect
      id={id}
      inDialog={inDialog}
      options={roles.map((role) => ({ value: String(role.id), label: role.name }))}
      value={value.map(String)}
      onChange={(next) => onChange(next.map(Number))}
      placeholder={t("rsvpAudiencePlaceholder")}
      searchPlaceholder={t("searchRoles")}
      emptyText={t("noRoles")}
    />
  );
}
