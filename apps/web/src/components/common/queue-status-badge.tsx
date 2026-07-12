import { StatusBadge } from "@/components/common/status-badge";
import { type Translate, useLocale } from "@/lib/i18n";
import type { QueueStatus } from "@/lib/queue";
import type { Tone } from "@/lib/tones";

/**
 * Queue stage pill (plan §5). Maps a queue_entries status to a stable
 * label + tone so the stage means the same color everywhere (panel, TV,
 * participant view). Unknown/legacy statuses fall back to neutral.
 */
function buildConfig(t: Translate): Record<QueueStatus, { label: string; tone: Tone }> {
  return {
    waiting: { label: t("queueStatusWaiting"), tone: "neutral" },
    called: { label: t("queueStatusCalled"), tone: "warning" },
    in_room: { label: t("queueStatusInRoom"), tone: "info" },
    presenting: { label: t("queueStatusPresenting"), tone: "brand" },
    completed: { label: t("queueStatusCompleted"), tone: "success" },
    disqualified: { label: t("queueStatusDisqualified"), tone: "danger" },
  };
}

export function QueueStatusBadge({
  status,
  className,
}: {
  status: QueueStatus | string;
  className?: string;
}) {
  const { t } = useLocale();
  const config = buildConfig(t);
  const cfg = config[status as QueueStatus] ?? { label: status, tone: "neutral" as Tone };
  return (
    <StatusBadge tone={cfg.tone} className={className}>
      {cfg.label}
    </StatusBadge>
  );
}
