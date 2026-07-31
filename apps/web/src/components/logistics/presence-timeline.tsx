import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  DoorOpenIcon,
  TimerOffIcon,
  WrenchIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import type {
  PresenceCertaintyWindow,
  PresenceConflict,
  PresenceTimelineData,
  PresenceTimelineSignal,
} from "@/lib/logistics";
import { durationMinutes, timelineRows } from "@/lib/presence-timeline";
import { cn } from "@/lib/utils";

function formatDuration(minutes: number, t: ReturnType<typeof useLocale>["t"]): string {
  if (minutes < 60) return t("presenceMinutesValue", { minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? t("presenceWholeHoursValue", { hours })
    : t("presenceHoursMinutesValue", { hours, minutes: remainder });
}

export function PresenceTimeline({
  data,
  canEdit = false,
  onEdit,
  onDelete,
  onResolve,
}: {
  data: PresenceTimelineData;
  canEdit?: boolean;
  onEdit?: (signal: PresenceTimelineSignal) => void;
  onDelete?: (signal: PresenceTimelineSignal) => void;
  onResolve?: (conflict: PresenceConflict) => void;
}) {
  const { language, t } = useLocale();
  const dateTime = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const rows = timelineRows(data.signals, data.windows);
  const gapLabel = formatDuration(data.certaintyWindowMinutes, t);

  return (
    <div className="space-y-4">
      {data.conflicts.map((conflict) => (
        <div
          key={`${conflict.firstLogId}-${conflict.secondLogId}`}
          role="alert"
          aria-live="assertive"
          className="border-destructive/40 bg-destructive/10 flex items-start gap-3 rounded-lg border p-4"
        >
          <AlertTriangleIcon
            className="text-destructive mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-destructive font-medium">{t("presenceConflictTitle")}</p>
            <p className="text-pretty mt-1 text-sm">
              {t("presenceConflictBody", {
                from: dateTime.format(new Date(conflict.from)),
                to: dateTime.format(new Date(conflict.to)),
              })}
            </p>
            {canEdit && onResolve && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => onResolve(conflict)}
              >
                <WrenchIcon className="size-4" aria-hidden="true" />
                {t("presenceResolveConflict")}
              </Button>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="bg-success size-2.5 rounded-full" aria-hidden="true" />
          {t("securedTime")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="border-primary size-2.5 rounded-full border-2" aria-hidden="true" />
          {t("provisionalWindow")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="border-muted-foreground size-2.5 rounded-full border border-dashed"
            aria-hidden="true"
          />
          {t("invalidatedWindow")}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <Clock3Icon className="text-muted-foreground mx-auto size-5" aria-hidden="true" />
          <p className="mt-2 font-medium">{t("noPresenceWindows")}</p>
          <p className="text-muted-foreground text-pretty mt-1 text-sm">
            {t("addSignalToStartWindow")}
          </p>
        </div>
      ) : (
        <ol className="space-y-3" aria-label={t("presenceWindows")}>
          {rows.map(({ signal, window }) => (
            <PresenceTimelineRow
              key={`${signal.source}-${signal.id}`}
              signal={signal}
              window={window}
              dateTime={dateTime}
              gapLabel={gapLabel}
              canEdit={canEdit}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function PresenceTimelineRow({
  signal,
  window,
  dateTime,
  gapLabel,
  canEdit,
  onEdit,
  onDelete,
}: {
  signal: PresenceTimelineSignal;
  window: PresenceCertaintyWindow | null;
  dateTime: Intl.DateTimeFormat;
  gapLabel: string;
  canEdit: boolean;
  onEdit?: (signal: PresenceTimelineSignal) => void;
  onDelete?: (signal: PresenceTimelineSignal) => void;
}) {
  const { t } = useLocale();
  const title =
    signal.kind === "activity"
      ? (signal.activityName ?? t("activitySignal"))
      : signal.kind === "in"
        ? t("entryOption")
        : t("exitOption");
  const StatusIcon = window?.conflict
    ? AlertTriangleIcon
    : window?.status === "secured"
      ? CheckCircle2Icon
      : window?.status === "provisional"
        ? Clock3Icon
        : TimerOffIcon;
  const statusTone: "danger" | "success" | "warning" | "neutral" = window?.conflict
    ? "danger"
    : window?.status === "secured"
      ? "success"
      : window?.status === "provisional"
        ? "warning"
        : "neutral";
  const typeTone: "success" | "warning" | "info" =
    signal.kind === "in" ? "success" : signal.kind === "out" ? "warning" : "info";
  const recordedBy = signal.recordedBy
    ? [signal.recordedBy.name, signal.recordedBy.surname].filter(Boolean).join(" ") ||
      `#${signal.recordedBy.userId}`
    : null;

  return (
    <li className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-start gap-2 font-medium">
            {signal.kind === "activity" ? (
              <ActivityIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <DoorOpenIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words text-pretty">{title}</span>
          </p>
          <p className="text-muted-foreground mt-1 text-xs tabular-nums">
            {dateTime.format(new Date(signal.occurredAt))}
          </p>
          {recordedBy ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {t("presenceRecordedBy", { name: recordedBy })}
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">{t("presenceRecordedBySystem")}</p>
          )}
          {signal.notes && (
            <p className="text-muted-foreground text-pretty mt-2 break-words text-sm">
              {signal.notes}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <StatusBadge tone={typeTone} dot={false}>
            {signal.kind === "activity" ? t("activitySignal") : title}
          </StatusBadge>
          {window && (
            <StatusBadge tone={statusTone} dot={false}>
              <StatusIcon className="size-3" aria-hidden="true" />
              {window.conflict
                ? t("presenceWindow_conflict")
                : t(
                    window.status === "secured"
                      ? "presenceSecured"
                      : window.status === "provisional"
                        ? "presenceProvisional"
                        : "presenceInvalid",
                  )}
            </StatusBadge>
          )}
        </div>
      </div>

      {window && <WindowMeter window={window} dateTime={dateTime} gapLabel={gapLabel} />}

      {canEdit && onEdit && onDelete && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`${t("edit")} ${title}`}
            onClick={() => onEdit(signal)}
          >
            {t("edit")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-destructive"
            aria-label={`${t("deleteAction")} ${title}`}
            onClick={() => onDelete(signal)}
          >
            {t("deleteAction")}
          </Button>
        </div>
      )}
    </li>
  );
}

function WindowMeter({
  window,
  dateTime,
  gapLabel,
}: {
  window: PresenceCertaintyWindow;
  dateTime: Intl.DateTimeFormat;
  gapLabel: string;
}) {
  const { t } = useLocale();
  const total = Date.parse(window.deadline) - Date.parse(window.start);
  const secured = window.securedUntil
    ? Date.parse(window.securedUntil) - Date.parse(window.start)
    : 0;
  const securedPercent = total > 0 ? Math.min(100, Math.max(0, (secured / total) * 100)) : 0;
  const provisional =
    window.status === "provisional"
      ? Math.min(Date.now(), Date.parse(window.deadline)) - Date.parse(window.start)
      : 0;
  const provisionalPercent =
    total > 0 ? Math.min(100, Math.max(0, (provisional / total) * 100)) : 0;

  return (
    <div className="mt-4" role="img" aria-label={t("windowGraphicDescription")}>
      <div
        className={cn(
          "bg-muted relative h-3 overflow-hidden rounded-full border",
          window.status === "invalid" && "border-dashed bg-transparent",
        )}
      >
        {provisionalPercent > 0 && (
          <div
            className="bg-warning/50 absolute inset-y-0 left-0"
            style={{ width: `${provisionalPercent}%` }}
          />
        )}
        {securedPercent > 0 && (
          <div
            className="bg-success absolute inset-y-0 left-0"
            style={{ width: `${securedPercent}%` }}
          />
        )}
        <span className="bg-primary absolute inset-y-0 left-0 w-0.5" />
        <span className="bg-foreground/50 absolute inset-y-0 right-0 w-0.5" />
      </div>
      <div className="text-muted-foreground mt-1.5 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs tabular-nums">
        <span>{dateTime.format(new Date(window.start))}</span>
        {window.securedUntil && (
          <span className="text-success font-medium">
            {t("presenceSecuredFor", {
              duration: formatDuration(durationMinutes(window.start, window.securedUntil), t),
            })}
          </span>
        )}
        <span>
          {t("presenceDeadline", {
            time: dateTime.format(new Date(window.deadline)),
          })}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">{t("windowOf", { duration: gapLabel })}</p>
    </div>
  );
}
