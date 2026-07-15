"use client";

import {
  ActivityIcon,
  CheckCircle2Icon,
  Clock3Icon,
  DoorOpenIcon,
  TimerOffIcon,
} from "lucide-react";
import { StatusBadge } from "@/components/common/status-badge";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import type { PresenceTimelineData } from "@/lib/logistics";
import { cn } from "@/lib/utils";

function durationLabel(start: string, end: string) {
  const minutes = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function PresenceTimeline({ data }: { data: PresenceTimelineData }) {
  const { language, t } = useLocale();
  const dateTime = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const gapLabel = durationLabel(
    new Date(0).toISOString(),
    new Date(data.certaintyWindowMinutes * 60_000).toISOString(),
  );

  if (data.windows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <Clock3Icon className="text-muted-foreground mx-auto size-5" aria-hidden="true" />
        <p className="mt-2 font-medium">{t("noPresenceWindows")}</p>
        <p className="text-muted-foreground text-pretty mt-1 text-sm">
          {t("addSignalToStartWindow")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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

      <ol className="space-y-3" aria-label={t("presenceWindows")}>
        {data.windows.map((window) => {
          const opener = data.signals.find(
            (signal) => signal.occurredAt === window.start && signal.kind === window.openedBy,
          );
          const total = Date.parse(window.deadline) - Date.parse(window.start);
          const secured = window.securedUntil
            ? Date.parse(window.securedUntil) - Date.parse(window.start)
            : 0;
          const securedPercent =
            total > 0 ? Math.min(100, Math.max(0, (secured / total) * 100)) : 0;
          const statusTone =
            window.status === "secured"
              ? "success"
              : window.status === "provisional"
                ? "info"
                : "neutral";
          const StatusIcon =
            window.status === "secured"
              ? CheckCircle2Icon
              : window.status === "provisional"
                ? Clock3Icon
                : TimerOffIcon;
          return (
            <li
              key={`${window.start}-${window.deadline}-${window.openedBy}-${window.closedBy ?? "open"}`}
              className="rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {window.openedBy === "activity" ? (
                      <ActivityIcon className="text-primary size-4" aria-hidden="true" />
                    ) : (
                      <DoorOpenIcon className="text-primary size-4" aria-hidden="true" />
                    )}
                    <span className="truncate">
                      {opener?.activityName ??
                        (window.openedBy === "activity" ? t("activitySignal") : t("entryOption"))}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                    {dateTime.format(new Date(window.start))} ·{" "}
                    {t("windowOf", { duration: gapLabel })}
                  </p>
                </div>
                <StatusBadge tone={statusTone} dot={false}>
                  <StatusIcon className="size-3" aria-hidden="true" />
                  {t(`presenceWindow_${window.status}`)}
                </StatusBadge>
              </div>

              <div className="mt-4" role="img" aria-label={t("windowGraphicDescription")}>
                <div
                  className={cn(
                    "bg-muted relative h-3 overflow-hidden rounded-full border",
                    window.status === "invalid" && "border-dashed bg-transparent",
                  )}
                >
                  {securedPercent > 0 && (
                    <div
                      className="bg-success absolute inset-y-0 left-0"
                      style={{ width: `${securedPercent}%` }}
                    />
                  )}
                  <span className="bg-primary absolute inset-y-0 left-0 w-0.5" />
                  <span className="bg-foreground/50 absolute inset-y-0 right-0 w-0.5" />
                </div>
                <div className="text-muted-foreground mt-1.5 flex justify-between gap-3 text-xs tabular-nums">
                  <span>{dateTime.format(new Date(window.start))}</span>
                  {window.securedUntil && (
                    <span className="text-success font-medium">
                      {t("securedDuration", {
                        duration: durationLabel(window.start, window.securedUntil),
                      })}
                    </span>
                  )}
                  <span>{dateTime.format(new Date(window.deadline))}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
