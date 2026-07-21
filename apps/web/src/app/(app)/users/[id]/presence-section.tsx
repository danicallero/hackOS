"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ClockIcon, DoorOpenIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { PresenceTimeline } from "@/components/logistics/presence-timeline";
import { errorMessage } from "@/components/logistics/ui";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type PresenceTimelineData,
  type PresenceTimelineSignal,
  type TimeLogEntry,
} from "@/lib/logistics";
import { useCan, useSessionContext } from "@/lib/session";
import { timeFmt } from "./datetime-format";
import { DeletePresenceActivityModal } from "./delete-presence-activity-modal";
import { DeleteTimeLogModal } from "./delete-time-log-modal";
import { EditTimeLogModal } from "./edit-time-log-modal";
import { PresenceSignalModal } from "./presence-signal-modal";

interface PresenceInterval {
  start: string;
  end: string;
  confirmed: boolean;
}

interface PresenceData {
  hours: number;
  intervals: PresenceInterval[];
  timeline: PresenceTimelineData;
}

/**
 * Estimated hours/intervals and the raw scans behind them, in one card with
 * one loading/error state — both read the same presence:scan|logistics:stats
 * capability and the same underlying data, so they should never disagree
 * about whether they loaded.
 */
export function PresenceSection({ userId }: { userId: number }) {
  const { t } = useLocale();
  const { canAny } = useSessionContext();
  const canRead = canAny(CAPABILITIES.PRESENCE_SCAN, CAPABILITIES.LOGISTICS_STATS);
  const canEdit = useCan(CAPABILITIES.PRESENCE_SCAN);
  const [data, setData] = useState<PresenceData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState<TimeLogEntry | null>(null);
  const [deleting, setDeleting] = useState<TimeLogEntry | null>(null);
  const [addingSignal, setAddingSignal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<PresenceTimelineSignal | null>(null);
  const [deletingActivity, setDeletingActivity] = useState<PresenceTimelineSignal | null>(null);

  const load = useCallback(async () => {
    if (!canRead) {
      setState("forbidden");
      return;
    }
    setState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const [hours, timeline] = await Promise.all([
        api.get<{ hours: number; intervals: PresenceInterval[] }>(`/api/presence/hours/${userId}`),
        logisticsApi.presenceTimeline(userId),
      ]);
      setData({ hours: hours.hours, intervals: hours.intervals, timeline });
      setState("ready");
    } catch (err) {
      setLoadError(errorMessage(err, t("attendanceDataUnavailable")));
      setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
    }
  }, [userId, canRead, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "forbidden") {
    return (
      <EmptyState
        icon={ClockIcon}
        title={t("presenceUnavailableTitle")}
        description={t("presenceUnavailableDesc")}
      />
    );
  }
  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "error" || !data) {
    return (
      <EmptyState
        icon={ClockIcon}
        title={t("couldNotLoadPresenceTitle")}
        description={loadError}
        action={
          <Button variant="outline" onClick={() => void load()}>
            {t("tryAgain")}
          </Button>
        }
      />
    );
  }

  const signalColumns: Column<PresenceTimelineSignal>[] = [
    {
      id: "when",
      header: t("colWhen"),
      sortValue: (signal) => signal.occurredAt,
      cell: (signal) => (
        <span className="text-sm tabular-nums">{timeFmt.format(new Date(signal.occurredAt))}</span>
      ),
    },
    {
      id: "kind",
      header: t("signalType"),
      cell: (signal) => (
        <StatusBadge
          tone={signal.kind === "in" ? "success" : signal.kind === "out" ? "warning" : "info"}
          dot={false}
        >
          {signal.kind === "activity"
            ? signal.activityName
            : signal.kind === "in"
              ? t("entryOption")
              : t("exitOption")}
        </StatusBadge>
      ),
    },
    {
      id: "notes",
      header: t("notes"),
      cell: (signal) => (
        <span className="text-muted-foreground line-clamp-2 text-sm">{signal.notes || "—"}</span>
      ),
    },
    {
      id: "scannedBy",
      header: t("colScannedBy"),
      cell: (signal) => (
        <span className="text-muted-foreground text-sm">
          {signal.recordedBy
            ? [signal.recordedBy.name, signal.recordedBy.surname].filter(Boolean).join(" ") ||
              `#${signal.recordedBy.userId}`
            : t("presenceSystemActor")}
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: t("columnActions"),
            align: "right" as const,
            cell: (signal: PresenceTimelineSignal) => (
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`${t("edit")} ${signal.activityName ?? t(`presenceSignal_${signal.kind}`)}`}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (signal.source === "door") {
                      setEditing({
                        id: signal.id,
                        kind: signal.kind as "in" | "out",
                        scannedAt: signal.occurredAt,
                        notes: signal.notes,
                        scannedBy: signal.recordedBy,
                      });
                    } else {
                      setEditingActivity(signal);
                    }
                  }}
                >
                  {t("edit")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  aria-label={`${t("deleteAction")} ${signal.activityName ?? t(`presenceSignal_${signal.kind}`)}`}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (signal.source === "door") {
                      setDeleting({
                        id: signal.id,
                        kind: signal.kind as "in" | "out",
                        scannedAt: signal.occurredAt,
                        notes: signal.notes,
                        scannedBy: signal.recordedBy,
                      });
                    } else {
                      setDeletingActivity(signal);
                    }
                  }}
                >
                  {t("deleteAction")}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <SectionCard icon={ClockIcon} title={t("presence")}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t("estimatedHours")}
          value={data.hours.toFixed(1)}
          hint={t("fromEntryExitActivity")}
          icon={ClockIcon}
        />
        <StatCard
          label={t("presenceCheckpoints")}
          value={String(data.intervals.length)}
          hint={t("presenceCheckpointsHint")}
        />
      </div>
      <PresenceTimeline data={data.timeline} />

      <Separator className="my-6" />

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-balance font-medium">{t("presenceSignals")}</h4>
          <p className="text-muted-foreground text-pretty mt-1 text-sm">
            {t("presenceSignalsDesc")}
          </p>
        </div>
        {canEdit && (
          <Button type="button" onClick={() => setAddingSignal(true)}>
            <PlusIcon className="size-4" aria-hidden="true" />
            {t("addPresenceSignal")}
          </Button>
        )}
      </div>
      <DataTable
        columns={signalColumns}
        data={data.timeline.signals}
        getRowId={(signal) => `${signal.source}-${signal.id}`}
        pageSize={10}
        empty={{
          icon: DoorOpenIcon,
          title: t("noPresenceRecorded"),
          description: t("noDoorActivityScans"),
        }}
      />
      {addingSignal && (
        <PresenceSignalModal
          userId={userId}
          activities={data.timeline.activities}
          onClose={() => setAddingSignal(false)}
          onSaved={() => {
            setAddingSignal(false);
            void load();
          }}
        />
      )}
      {editingActivity && (
        <PresenceSignalModal
          userId={userId}
          activities={data.timeline.activities}
          signal={editingActivity}
          onClose={() => setEditingActivity(null)}
          onSaved={() => {
            setEditingActivity(null);
            void load();
          }}
        />
      )}
      {editing && (
        <EditTimeLogModal
          log={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {deleting && (
        <DeleteTimeLogModal
          log={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      )}
      {deletingActivity && (
        <DeletePresenceActivityModal
          signal={deletingActivity}
          onClose={() => setDeletingActivity(null)}
          onDeleted={() => {
            setDeletingActivity(null);
            void load();
          }}
        />
      )}
    </SectionCard>
  );
}
