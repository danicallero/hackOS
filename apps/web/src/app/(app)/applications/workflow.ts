import type { Translate } from "@/lib/i18n";
import type { ResponseRow } from "./lib";

export type ApplicationWorkspace = "review" | "decisions" | "communication" | "confirmation";
export type SaveState = "saved" | "saving" | "unsaved" | "error";

export function availableApplicationWorkspaces(capabilities: {
  manage: boolean;
  review: boolean;
  decide: boolean;
}): Array<"builder" | ApplicationWorkspace> {
  return [
    ...(capabilities.manage ? (["builder"] as const) : []),
    ...(capabilities.review ? (["review"] as const) : []),
    ...(capabilities.decide ? (["decisions", "communication", "confirmation"] as const) : []),
  ];
}

const WORKSPACE_STATUSES: Record<ApplicationWorkspace, ReadonlySet<string>> = {
  review: new Set(["submitted", "review"]),
  decisions: new Set(["review", "accepted_internal", "rejected_internal"]),
  communication: new Set(["accepted_internal", "rejected_internal", "accepted", "rejected"]),
  confirmation: new Set(["accepted", "confirmed", "declined", "expired"]),
};

export function rowsForWorkspace(
  rows: ResponseRow[],
  workspace: ApplicationWorkspace,
): ResponseRow[] {
  const statuses = WORKSPACE_STATUSES[workspace];
  return rows.filter((row) => statuses.has(row.status));
}

export function applicationStatusLabel(status: string, t: Translate): string {
  const labels: Record<string, string> = {
    draft: t("statusDraft"),
    submitted: t("statusSubmitted"),
    review: t("statusInReview"),
    accepted_internal: t("acceptedInternalOnly"),
    rejected_internal: t("rejectedInternalOnly"),
    accepted: t("acceptanceSent"),
    rejected: t("rejectionSent"),
    confirmed: t("confirmed"),
    declined: t("declined"),
    expired: t("applicationStatusExpired"),
  };
  return labels[status] ?? t("unknownStatus");
}

export function generatedFieldKey(label: string, existing: string[] = []): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "question";
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

export function saveStateLabel(state: SaveState, t: Translate): string {
  return {
    saved: t("saveStateSaved"),
    saving: t("saveStateSaving"),
    unsaved: t("saveStateUnsaved"),
    error: t("saveStateError"),
  }[state];
}

export function applicantTimelineState(status: string, submittedAt: string | null) {
  const decisionReached = ["accepted", "rejected", "confirmed", "declined", "expired"].includes(
    status,
  );
  return {
    application: true,
    submitted: Boolean(submittedAt),
    review: Boolean(submittedAt),
    decision: decisionReached,
    place: ["confirmed", "declined", "expired"].includes(status),
  };
}
