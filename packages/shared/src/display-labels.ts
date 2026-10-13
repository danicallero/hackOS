import {
  activityKindLabelKey,
  DEFAULT_ACTIVITY_KIND,
  toActivityKind,
} from "@hackos/shared/activity-kinds";
export function scheduleTypeLabel(
  type: string | null | undefined,
  t: (key: ReturnType<typeof activityKindLabelKey>) => string,
): string {
  return t(activityKindLabelKey(toActivityKind(type) ?? DEFAULT_ACTIVITY_KIND));
}
/** H8: role names are admin-authored, never translated or used as authorization. */
export function roleDisplayName(role: string | null, t: (key: "roleUnassigned") => string): string {
  return role ?? t("roleUnassigned");
}
