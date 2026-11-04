import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";

/**
 * Canonical evaluation status display across judging, project and review
 * workspaces (H36, H46). Drafts intentionally use info so the state reads
 * consistently on editing and read/correction surfaces.
 */
export function ReviewStatusBadge({
  status,
  score,
}: {
  /** null renders "not started". */
  status: "draft" | "submitted" | null;
  /** Shown inline when status is "submitted"; ignored otherwise. */
  score?: number | null;
}) {
  const { t } = useLocale();

  if (status === "submitted") {
    return (
      <StatusBadge tone="success">
        {score !== null && score !== undefined
          ? t("challengeReviewSubmittedWithNota", { nota: score })
          : t("challengeReviewSubmitted")}
      </StatusBadge>
    );
  }
  if (status === "draft") {
    return <StatusBadge tone="info">{t("challengeReviewDraft")}</StatusBadge>;
  }
  return <StatusBadge tone="neutral">{t("challengeReviewNotStarted")}</StatusBadge>;
}
