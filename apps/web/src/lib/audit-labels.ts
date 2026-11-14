// H53: localized audit actions, subjects, sources and executor attribution.

import type { Translate } from "@/lib/i18n";
import type { AuditRow } from "@/lib/notifications";
import { applicationStatusLabel } from "./application-workflow";
import { AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_SOURCES } from "./audit-catalog";
import { formatDiffValue } from "./audit-diff";
import { capabilityDescription } from "./capability-presentation";

/** "queue_regenerate" -> "Queue regenerate", "queue_group.clear" -> "Queue group · Clear" */
function humanizeAction(action: string): string {
  return action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(".")
    .map((segment) =>
      segment
        .split("_")
        .filter(Boolean)
        .map((word, i) => (i === 0 ? word[0].toUpperCase() + word.slice(1) : word))
        .join(" "),
    )
    .join(" · ");
}

/** Raw action -> i18n key in web.json, for the actions worth hand-written copy. */
const ACTION_LABEL_KEYS: Record<string, string> = {
  review_scored: "auditActionReviewEdited",
  staff_notes_updated: "auditActionStaffNotesEdited",
  queue_regenerate: "auditActionQueueRegenerate",
  "queue_group.clear": "auditActionQueueGroupClear",
  accept: "auditActionAccept",
  manual_time_log: "auditActionManualTimeLog",
  assign: "auditActionAssign",
  create: "auditActionCreate",
  delete_time_log: "auditActionDeleteTimeLog",
};

export function getActionLabel(action: string, t: Translate): string {
  const key = (AUDIT_ACTIONS as Record<string, string>)[action] ?? ACTION_LABEL_KEYS[action];
  return key ? t(key as Parameters<Translate>[0]) : humanizeAction(action);
}

export function getAuditEntityLabel(entityType: string, t: Translate): string {
  const key = (AUDIT_ENTITIES as Record<string, string>)[entityType];
  return key ? t(key as Parameters<Translate>[0]) : humanizeAction(entityType);
}

/** H53: "University · UDC" when the subject has a name, "University #12" otherwise. */
export function entityRef(
  row: Pick<AuditRow, "entity_type" | "entity_id" | "entity_label">,
  t: Translate,
) {
  const type = getAuditEntityLabel(row.entity_type, t);
  return row.entity_label ? `${type} · ${row.entity_label}` : `${type} #${row.entity_id}`;
}

export function getAuditEntityHref(entityType: string, id: string): string | null {
  const routes: Record<string, string> = {
    user: "/users",
    application: "/applications",
    application_response: "/applications/response",
    project: "/projects",
    project_github_link: "/projects",
    enterprise: "/enterprises",
    challenge: "/challenges",
  };
  return routes[entityType] ? `${routes[entityType]}/${encodeURIComponent(id)}` : null;
}

export function getAuditActorLabel(row: AuditRow, t: Translate): string {
  if (row.actor_id) return auditActorLabel(row) ?? `#${row.actor_id}`;
  if (row.actor_kind === "token") return t("auditActorToken");
  if (row.actor_kind === "device") return t("auditActorDevice");
  if (row.actor_kind === "anonymous") return t("auditActorAnonymous");
  if (row.actor_kind === "system" || row.source === "system") return t("systemActor");
  return t("auditActorUnknown");
}

/**
 * One plain-language sentence describing what happened, for the detail
 * route. Falls back to a generic "{actor} performed {action} on {entity}"
 * for the long tail of actions that don't have curated copy.
 */
export function getAuditSummary(
  row: Pick<AuditRow, "action" | "entity_type" | "entity_id" | "entity_label" | "after">,
  actorLabel: string,
  t: Translate,
): string {
  const entity = entityRef(row, t);
  switch (row.action) {
    case "review_scored":
      return t("auditSummaryReviewEdited", { actor: actorLabel, entity });
    case "queue_regenerate":
      return t("auditSummaryQueueRegenerate", { actor: actorLabel, entity });
    case "queue_group.clear":
      return t("auditSummaryQueueGroupClear", { actor: actorLabel, entity });
    case "accept":
      return t("auditSummaryAccept", { actor: actorLabel, entity });
    case "manual_time_log":
      return t("auditSummaryManualTimeLog", { actor: actorLabel, entity });
    case "assign":
      return t("auditSummaryAssign", { actor: actorLabel, entity });
    case "create":
      return t("auditSummaryCreate", { actor: actorLabel, entity });
    case "delete_time_log":
      return t("auditSummaryDeleteTimeLog", { actor: actorLabel, entity });
    default:
      return t("auditSummaryGeneric", {
        actor: actorLabel,
        action: getActionLabel(row.action, t).toLowerCase(),
        entity,
      });
  }
}

export function auditActorLabel(
  row: Pick<AuditRow, "actor_name" | "actor_surname" | "actor_email">,
) {
  const fullName = [row.actor_name, row.actor_surname].filter(Boolean).join(" ").trim();
  return fullName || row.actor_email || null;
}

/** H53: known operational fields use the same copy as the review UI. */
export function getAuditFieldLabel(field: string, t: Translate): string {
  if (field.startsWith("capabilities."))
    return capabilityDescription(field.slice("capabilities.".length), t) || humanizeAction(field);
  if (field === "capabilities") return t("permissions");
  if (field === "status") return t("colStatus");
  if (["userId", "user_id", "subjectUserId", "subject_user_id"].includes(field))
    return getAuditEntityLabel("user", t);
  if (field === "notes") return t("notesLabel");
  if (field === "score") return t("scoreColumn");
  return humanizeAction(field);
}

export function getAuditSourceLabel(source: string, t: Translate): string {
  const key = (AUDIT_SOURCES as Record<string, string>)[source];
  return key ? t(key as Parameters<Translate>[0]) : humanizeAction(source);
}

export function getAuditValueLabel(
  value: unknown,
  field: string,
  entityType: string,
  t: Translate,
): string {
  if (value === "[private]") return t("auditValuePrivate");
  if (value === null) return t("notSet");
  if (field.startsWith("capabilities.") && typeof value === "string") {
    const labels: Record<string, Parameters<Translate>[0]> = {
      allow: "panelAccessAllow",
      deny: "panelAccessDeny",
      inherit: "panelAccessInherit",
    };
    if (labels[value.toLowerCase()]) return t(labels[value.toLowerCase()]);
  }
  if (entityType === "application_response" && field === "status" && typeof value === "string")
    return applicationStatusLabel(value, t);
  return formatDiffValue(value);
}
