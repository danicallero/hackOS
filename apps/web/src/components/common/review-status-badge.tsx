import { StatusBadge } from "@/components/common/status-badge";
import { StatusDot } from "@/components/common/status-dot";
import { useLocale } from "@/lib/i18n";

/**
 * Canonical evaluation status display across judging, project and review
 * workspaces (H36, H46). Drafts intentionally use info so the state reads
 * consistently on editing and read/correction surfaces.
 */
export function ReviewStatusBadge({
  status,
  score,
  quiet = false,
}: {
  /** null renders "not started". */
  status: "draft" | "submitted" | null;
  /** Shown inline when status is "submitted"; ignored otherwise. */
  score?: number | null;
  /** A dot and label instead of a pill, for headers that already carry other emphasis. */
  quiet?: boolean;
}) {
  const { t } = useLocale();

  const Marker = quiet ? StatusDot : StatusBadge;
  if (status === "submitted") {
    return (
      <Marker tone="success">
        {score !== null && score !== undefined
          ? t("challengeReviewSubmittedWithNota", { nota: score })
          : t("challengeReviewSubmitted")}
      </Marker>
    );
  }
  if (status === "draft") {
    return <Marker tone="info">{t("challengeReviewDraft")}</Marker>;
  }
  return <Marker tone="neutral">{t("challengeReviewNotStarted")}</Marker>;
}
