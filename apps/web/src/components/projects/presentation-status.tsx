"use client";

import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
  const inRoom = status === "presenting" || status === "in_room";
  const judged = status === "completed";
  const roomNames = assignedRoomName || rooms.map((room) => room.name).join(", ");
  const minutes = Math.max(0, Math.ceil(etaMinutes ?? 0));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const duration = t(
    hours === 0 ? "durationMinutes" : remainder === 0 ? "durationHours" : "durationHoursMinutes",
    { hours, minutes: hours === 0 ? minutes : remainder },
  );
  return (
    <div className={cn("@container min-w-0", judged && "opacity-60")}>
      <div className="grid min-w-0 grid-cols-2 items-center gap-x-3 gap-y-2 text-sm @min-[24rem]:grid-cols-[minmax(7rem,1fr)_minmax(5rem,auto)_minmax(7rem,1fr)]">
        <div>
          <QueueStatusBadge status={status} />
        </div>
        {status === "waiting" && position != null ? (
          <span className="tabular-nums">{t("queuePosition", { position })}</span>
        ) : (
          <span aria-hidden="true" />
        )}
        {status === "waiting" && etaMinutes != null ? (
          <span className="col-span-2 inline-flex items-center gap-1 text-muted-foreground tabular-nums @min-[24rem]:col-span-1">
            <ClockIcon aria-hidden="true" className="size-4" />
            {t("projectPresentationEtaDuration", { duration })}
          </span>
        ) : (
          <span aria-hidden="true" className="hidden @min-[24rem]:block" />
        )}
        {inRoom && <span className="col-span-full font-semibold">{t("queueBeInRoom")}</span>}
        {roomNames && !judged && (
          <span
            className={cn(
              "col-span-full inline-flex min-w-0 items-start gap-1",
              inRoom ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            <MapPinIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="wrap-break-word">{roomNames}</span>
          </span>
        )}
      </div>
    </div>
  );
}
