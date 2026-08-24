// Human-readable presentation for raw audit_log `action`/`entity_type`
// strings (H53). ~100 distinct actions exist across the codebase — most get
// a generic humanized label; a curated subset (the highest-traffic/least
// obvious ones) gets real copy via i18n keys instead.

import type { Translate } from "@/lib/i18n";
import type { AuditRow } from "@/lib/notifications";

/** "queue_regenerate" -> "Queue regenerate", "queue_group.clear" -> "Queue group · Clear" */
export function humanizeAction(action: string): string {
  return action
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
  queue_regenerate: "auditActionQueueRegenerate",
  "queue_group.clear": "auditActionQueueGroupClear",
  accept: "auditActionAccept",
  manual_time_log: "auditActionManualTimeLog",
  assign: "auditActionAssign",
  create: "auditActionCreate",
  delete_time_log: "auditActionDeleteTimeLog",
};

export function getActionLabel(action: string, t: Translate): string {
  const key = ACTION_LABEL_KEYS[action];
  return key ? t(key as Parameters<Translate>[0]) : humanizeAction(action);
}

function entityRef(entityType: string, entityId: string, t: Translate) {
  return entityType === "user" ? t("userInline", { id: entityId }) : `${entityType} #${entityId}`;
}

/**
 * One plain-language sentence describing what happened, for the detail
 * route. Falls back to a generic "{actor} performed {action} on {entity}"
 * for the long tail of actions that don't have curated copy.
 */
export function getAuditSummary(
  row: Pick<AuditRow, "action" | "entity_type" | "entity_id" | "after">,
  actorLabel: string,
  t: Translate,
): string {
  const entity = entityRef(row.entity_type, row.entity_id, t);
  switch (row.action) {
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
        action: humanizeAction(row.action).toLowerCase(),
        entity,
      });
  }
}
