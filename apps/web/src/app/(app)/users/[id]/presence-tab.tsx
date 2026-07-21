"use client";

// Door in/out intervals and their corrections (H24): the timeline plus the
// four modals that edit or delete a log.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ClockIcon, DoorOpenIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { PresenceTimeline } from "@/components/logistics/presence-timeline";
import { errorMessage, InlineError } from "@/components/logistics/ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type PresenceTimelineData,
  type PresenceTimelineSignal,
  type TimeLogEntry,
} from "@/lib/logistics";
import { useCan, useSessionContext } from "@/lib/session";
import { timeFmt } from "./shared";

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

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

export function EditTimeLogModal({
  log,
  onClose,
  onSaved,
}: {
  log: TimeLogEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [kind, setKind] = useState<"in" | "out">(log.kind);
  const [scannedAt, setScannedAt] = useState(toDatetimeLocal(log.scannedAt));
  const [notes, setNotes] = useState(log.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    try {
      await logisticsApi.updateTimeLog(log.id, {
        kind,
        scannedAt: new Date(scannedAt).toISOString(),
        notes: notes.trim() || null,
      });
      toast.success(t("scanUpdated"));
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t("couldNotUpdateScan")));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("editDoorScan")}
      description={t("changesRecordedAuditLog")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <SubmitButton pending={pending} onClick={save}>
            {t("saveChanges")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="edit-presence-kind">{t("directionLabel")}</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as "in" | "out")}>
            <SelectTrigger id="edit-presence-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in">{t("entryOption")}</SelectItem>
              <SelectItem value="out">{t("exitOption")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-presence-time">{t("timeLabel")}</Label>
          <DateTimeInput id="edit-presence-time" value={scannedAt} onChange={setScannedAt} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-presence-notes">{t("notes")}</Label>
          <Textarea
            id="edit-presence-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        {error && <InlineError message={error} />}
      </div>
    </Modal>
  );
}

export function DeleteTimeLogModal({
  log,
  onClose,
  onDeleted,
}: {
  log: TimeLogEntry;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    try {
      await logisticsApi.deleteTimeLog(log.id);
      toast.success(t("scanDeleted"));
      onDeleted();
    } catch (err) {
      toast.error(errorMessage(err, t("couldNotDeleteScan")));
      setPending(false);
    }
  }

  return (
    <AlertModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deleteThisScan")}
      description={t("removesEntryExitScan", {
        direction: log.kind === "in" ? t("entryLower") : t("exitLower"),
        time: timeFmt.format(new Date(log.scannedAt)),
      })}
      cancelLabel={t("cancel")}
      confirmLabel={t("deleteAction")}
      pending={pending}
      destructive
      onConfirm={() => void remove()}
    />
  );
}

export function PresenceSignalModal({
  userId,
  activities,
  signal,
  onClose,
  onSaved,
}: {
  userId: number;
  activities: PresenceTimelineData["activities"];
  signal?: PresenceTimelineSignal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const editingActivity = signal?.source === "activity";
  const [kind, setKind] = useState<"in" | "out" | "activity">(editingActivity ? "activity" : "in");
  const [activityId, setActivityId] = useState(
    signal?.activityId ? String(signal.activityId) : activities[0] ? String(activities[0].id) : "",
  );
  const [occurredAt, setOccurredAt] = useState(
    signal ? toDatetimeLocal(signal.occurredAt) : toDatetimeLocal(new Date().toISOString()),
  );
  const [notes, setNotes] = useState(signal?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!occurredAt || (kind === "activity" && !activityId)) return;
    setPending(true);
    setError("");
    try {
      if (editingActivity && signal) {
        await logisticsApi.updatePresenceActivity(signal.id, {
          activityId: Number(activityId),
          occurredAt: new Date(occurredAt).toISOString(),
          notes: notes.trim() || null,
        });
      } else if (kind === "activity") {
        await logisticsApi.createPresenceSignal(userId, {
          kind,
          activityId: Number(activityId),
          occurredAt: new Date(occurredAt).toISOString(),
          notes: notes.trim() || null,
        });
      } else {
        await logisticsApi.createPresenceSignal(userId, {
          kind,
          occurredAt: new Date(occurredAt).toISOString(),
          notes: notes.trim() || null,
        });
      }
      toast.success(editingActivity ? t("presenceSignalUpdated") : t("presenceSignalAdded"));
      onSaved();
    } catch (err) {
      setError(errorMessage(err, t("couldNotSavePresenceSignal")));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={editingActivity ? t("editPresenceActivity") : t("addPresenceSignal")}
      description={t("presenceSignalFormDesc")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <SubmitButton
            pending={pending}
            onClick={save}
            disabled={!occurredAt || (kind === "activity" && !activityId)}
          >
            {t("saveChanges")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-4">
        {!editingActivity && (
          <div className="space-y-2">
            <Label htmlFor="presence-signal-kind">{t("signalType")}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
              <SelectTrigger id="presence-signal-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">{t("entryOption")}</SelectItem>
                <SelectItem value="activity">{t("activitySignal")}</SelectItem>
                <SelectItem value="out">{t("exitOption")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {kind === "activity" && (
          <div className="space-y-2">
            <Label htmlFor="presence-activity">{t("colActivity")}</Label>
            <Select value={activityId} onValueChange={setActivityId}>
              <SelectTrigger id="presence-activity" className="w-full">
                <SelectValue placeholder={t("chooseActivityOption")} />
              </SelectTrigger>
              <SelectContent>
                {activities.map((activity) => (
                  <SelectItem key={activity.id} value={String(activity.id)}>
                    {activity.name} · {activity.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="presence-signal-time">{t("timeLabel")}</Label>
          <DateTimeInput
            id="presence-signal-time"
            value={occurredAt}
            max={toDatetimeLocal(new Date().toISOString())}
            onChange={setOccurredAt}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="presence-signal-notes">{t("notes")}</Label>
          <Textarea
            id="presence-signal-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={t("presenceSignalNotesPlaceholder")}
          />
        </div>
        {error && <InlineError message={error} />}
      </div>
    </Modal>
  );
}

export function DeletePresenceActivityModal({
  signal,
  onClose,
  onDeleted,
}: {
  signal: PresenceTimelineSignal;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setPending(true);
    setError("");
    try {
      await logisticsApi.deletePresenceActivity(signal.id);
      toast.success(t("presenceSignalDeleted"));
      onDeleted();
    } catch (err) {
      setError(errorMessage(err, t("couldNotDeletePresenceSignal")));
      setPending(false);
    }
  }

  return (
    <AlertModal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("deletePresenceSignal")}
      description={t("deletePresenceActivityDesc", {
        activity: signal.activityName ?? t("activitySignal"),
        time: timeFmt.format(new Date(signal.occurredAt)),
      })}
      cancelLabel={t("cancel")}
      confirmLabel={t("deleteAction")}
      pending={pending}
      destructive
      onConfirm={() => void remove()}
    >
      {error && <InlineError message={error} />}
    </AlertModal>
  );
}
