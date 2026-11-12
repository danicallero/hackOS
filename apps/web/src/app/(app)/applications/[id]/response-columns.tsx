import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import type { Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import {
  type ApplicationWorkspace,
  applicationStatusLabel,
  applicationStatusTone,
} from "@/lib/application-workflow";
import { fmtScore, type ResponseRow } from "@/lib/applications";
import { formatEventDate } from "@/lib/datetime";
import type { Translate } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** Table columns of the responses list; the Sent workspace adds delivery and deadline. */
export function buildResponseColumns({
  t,
  language,
  meId,
  workspace,
}: {
  t: Translate;
  language: Language;
  meId: number | undefined;
  workspace: ApplicationWorkspace;
}): Column<ResponseRow>[] {
  const columns: Column<ResponseRow>[] = [
    {
      id: "applicant",
      header: t("applicantColumn"),
      sortValue: (r) => (r.name ?? r.email).toLowerCase(),
      cell: (r) => (
        <div className="space-y-0.5">
          <div className="font-medium">{r.name ?? "—"}</div>
          <div className="text-muted-foreground text-xs">{r.email}</div>
        </div>
      ),
    },
    {
      id: "status",
      width: "w-36",
      header: t("statusColumn"),
      sortValue: (r) => r.status,
      cell: (r) => (
        <StatusBadge tone={applicationStatusTone(r.status)}>
          {applicationStatusLabel(r.status, t)}
        </StatusBadge>
      ),
    },
    {
      id: "score",
      width: "w-28",
      header: t("scoreColumn"),
      align: "right",
      sortValue: (r) => Number(r.avg_score ?? -1),
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          {r.reviews.some((review) => review.author_id === meId && review.score != null) && (
            <CheckCircleIcon className="text-success size-3.5" aria-label={t("reviewedByYou")} />
          )}
          {fmtScore(r.avg_score)}
          {r.review_count > 0 && (
            <span className="text-muted-foreground text-xs"> · {r.review_count}</span>
          )}
        </span>
      ),
    },
    {
      id: "submitted",
      width: "w-44",
      header: t("dataStatusSubmitted"),
      align: "right",
      sortValue: (r) => r.submitted_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm">
          {formatEventDate(r.submitted_at, language, "dateTime") || "—"}
        </span>
      ),
    },
  ];

  if (workspace === "sent") {
    columns.push({
      id: "communicated",
      width: "w-44",
      header: t("decisionDeliveryColumn"),
      align: "right",
      sortValue: (r) => r.decision_sent_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {r.decision_sent_at
            ? formatEventDate(r.decision_sent_at, language, "dateTime") || "—"
            : t("notSentYet")}
        </span>
      ),
    });
    columns.push({
      id: "deadline",
      width: "w-44",
      header: t("confirmationDeadlineColumn"),
      align: "right",
      sortValue: (r) => r.confirmation_expires_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {r.confirmation_expires_at
            ? formatEventDate(r.confirmation_expires_at, language, "dateTime") || "—"
            : "—"}
        </span>
      ),
    });
  }

  return columns;
}
