import { StatusBadge } from "@/components/common/status-badge";
import type { QueueStatus } from "@/lib/queue";
import type { Tone } from "@/lib/tones";

/**
 * Queue stage pill (plan §5). Maps a queue_entries status to a stable
 * label + tone so the stage means the same color everywhere (panel, TV,
 * participant view). Unknown/legacy statuses fall back to neutral.
 */
const CONFIG: Record<QueueStatus, { label: string; tone: Tone }> = {
  waiting: { label: "In queue", tone: "neutral" },
  called: { label: "Called", tone: "warning" },
  in_room: { label: "In room", tone: "info" },
  presenting: { label: "Presenting", tone: "brand" },
  completed: { label: "Evaluated", tone: "success" },
  disqualified: { label: "Disqualified", tone: "danger" },
};

export function QueueStatusBadge({
  status,
  className,
}: {
  status: QueueStatus | string;
  className?: string;
}) {
  const cfg = CONFIG[status as QueueStatus] ?? { label: status, tone: "neutral" as Tone };
  return (
    <StatusBadge tone={cfg.tone} className={className}>
      {cfg.label}
    </StatusBadge>
  );
}
