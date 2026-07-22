import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";

/** Canonical evaluation status display across project and review workspaces (H36). */
export function ReviewStatusBadge({
  status,
  score,
}: {
  status: "draft" | "submitted" | null;
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
