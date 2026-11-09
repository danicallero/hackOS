import type { AuditEntry } from "./audit.js";
import { getRequestContext } from "./request-context.js";

export type AuditActorKind = "user" | "system" | "token" | "device" | "anonymous" | "unknown";

/** H53: initiator, executor and subject are separate facts; never infer identity from a target. */
export function resolveAuditActor(entry: AuditEntry) {
  const context = getRequestContext();
  const identityFree = entry.ip === null && entry.userAgent === null;
  const sessionActor = context?.getActorId?.() ?? null;
  const tokenSource = ["email", "email_link", "link"].includes(entry.source ?? "");
  const kind: AuditActorKind =
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
