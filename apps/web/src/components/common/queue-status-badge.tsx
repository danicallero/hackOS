import { StatusBadge } from "@/components/common/status-badge";
import { StatusDot } from "@/components/common/status-dot";
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
  /** Accepts a raw string too, so an unrecognized/legacy value renders as
   *  itself in a neutral badge instead of throwing. */
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

/** Quiet stage marker for dense lists: the badge's tone as a dot beside its label, no pill. */
export function QueueStatusDot({
  status,
  label,
  tone,
  className,
}: {
  status?: QueueStatus | string;
  /** Overrides the stage label (for example "Now"). */
  label?: string;
  tone?: Tone;
  className?: string;
}) {
  const { t } = useLocale();
  const cfg = (status ? buildConfig(t)[status as QueueStatus] : undefined) ?? {
    label: status ?? "",
    tone: "neutral" as Tone,
  };
  return (
    <StatusDot tone={tone ?? cfg.tone} className={className}>
      {label ?? cfg.label}
    </StatusDot>
  );
}
