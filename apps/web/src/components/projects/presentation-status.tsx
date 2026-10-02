"use client";

import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { useLocale } from "@/lib/i18n";

/** H38: one presentation summary for participant and operational project views. */
export function PresentationStatus({
  status,
  position,
  etaMinutes,
  assignedRoomName,
  rooms = [],
}: {
  status: string | null;
  position: number | null;
  etaMinutes: number | null;
  assignedRoomName?: string | null;
  rooms?: { name: string }[];
}) {
  const { t } = useLocale();
  if (!status) return null;
  const roomNames = assignedRoomName || rooms.map((room) => room.name).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <QueueStatusBadge status={status} />
      {status === "waiting" && position != null && (
        <span className="tabular-nums">{t("queuePosition", { position })}</span>
      )}
      {status === "waiting" && etaMinutes != null && (
        <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
          <ClockIcon aria-hidden="true" className="size-4" />
          {t("projectPresentationEta", { minutes: etaMinutes })}
        </span>
      )}
      {roomNames && (
        <span className="inline-flex min-w-0 items-start gap-1 text-muted-foreground">
          <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{roomNames}</span>
        </span>
      )}
    </div>
  );
}
