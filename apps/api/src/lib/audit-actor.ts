import type { AuditEntry } from "./audit.js";
import { getRequestContext } from "./request-context.js";

export type AuditActorKind = "user" | "system" | "token" | "device" | "anonymous" | "unknown";

/** H53: only action/entity pairs whose executor is unambiguously automatic. */
export function intrinsicAuditExecutor(
  entityType: string,
  action: string,
): "system" | "device" | null {
  const systemActions: Record<string, readonly string[]> = {
    presence: ["event_end_auto_exit"],
    application_response: ["expired"],
    schedule: ["scheduled_reveal"],
    challenge: ["scheduled_reveal"],
    enterprise: ["scheduled_reveal"],
    challenge_winner_publication: ["scheduled_publish"],
    event_email_reminder: ["expired", "queued"],
    data_subject_request: [
      "export_completed",
      "export_failed",
      "deletion_completed",
      "deletion_failed",
      "fixture_scope_marked",
    ],
    announcement: ["fixture_scope_marked"],
  };
  if (systemActions[entityType]?.includes(action)) return "system";
  if (
    entityType === "wallet_pass_device" &&
    ["registered", "updated", "unregistered"].includes(action)
  )
    return "device";
  return null;
}

/** H53: initiator, executor and subject are separate facts; never infer identity from a target. */
export function resolveAuditActor(entry: AuditEntry) {
  const context = getRequestContext();
  const identityFree = entry.ip === null && entry.userAgent === null;
  const sessionActor = context?.getActorId?.() ?? null;
  const intrinsic = intrinsicAuditExecutor(entry.entityType, entry.action);
  const tokenSource = ["email", "email_link", "link"].includes(entry.source ?? "");
  const kind: AuditActorKind =
    intrinsic ??
    entry.actorKind ??
    (tokenSource
      ? "token"
      : entry.source === "system" || (!context && entry.actorId === null)
        ? "system"
        : entry.actorId !== null
          ? "user"
          : "anonymous");
  const actorId = kind === "user" ? (sessionActor ?? entry.actorId) : null;
  const initiatedBy = identityFree
    ? null
    : entry.initiatedBy !== undefined
      ? entry.initiatedBy
      : kind === "system"
        ? (entry.actorId ?? sessionActor)
        : null;
  return {
    actorId,
    kind,
    initiatedBy,
    source:
      intrinsic ??
      entry.source ??
      (kind === "system"
        ? "system"
        : kind === "device"
          ? "device"
          : kind === "token"
            ? "link"
            : context
              ? "web"
              : "admin"),
    requestId: identityFree ? null : (context?.requestId ?? null),
  };
}
