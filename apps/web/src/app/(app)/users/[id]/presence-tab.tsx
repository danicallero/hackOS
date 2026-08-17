"use client";

// Door in/out intervals and their corrections (H24): the timeline plus the
// four modals that edit or delete a log.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ClockIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type PresenceConflict,
  type PresenceTimelineData,
  type PresenceTimelineSignal,
  type TimeLogEntry,
} from "@/lib/logistics";
import { conflictBounds, guaranteedMinutes, provisionalMinutes } from "@/lib/presence-timeline";
import { useCan, useSessionContext } from "@/lib/session";
import { formatUserDate } from "./shared";

interface PresenceData {
  timeline: PresenceTimelineData;
}

function toDatetimeLocal(iso: string, includeSeconds = false): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return includeSeconds ? `${value}:${pad(d.getSeconds())}` : value;
}

/**
 * The web projection follows the mobile presence model (H24): one timeline
 * owns both the guaranteed/provisional summary and every signal/window. This
 * keeps edits, conflict repair, and freshness on the same read model.
 */
export function PresenceSection({ userId, refreshKey }: { userId: number; refreshKey?: number }) {
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
  const [resolvingConflict, setResolvingConflict] = useState<PresenceConflict | null>(null);

  const load = useCallback(async () => {
    if (!canRead) {
      setState("forbidden");
      return;
    }
    setState((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const timeline = await logisticsApi.presenceTimeline(userId);
      setData({ timeline });
      setState("ready");
    } catch (err) {
      setLoadError(errorMessage(err, t("attendanceDataUnavailable")));
      setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
    }
  }, [userId, canRead, t]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a ping-only nonce from the profile event stream.
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

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

  return (
    <SectionCard
      icon={ClockIcon}
      title={t("presence")}
      action={
        canEdit ? (
          <Button type="button" onClick={() => setAddingSignal(true)}>
            <PlusIcon className="size-4" aria-hidden="true" />
            {t("addPresenceSignal")}
          </Button>
        ) : undefined
      }
    >
      <h3 className="text-balance font-medium">{t("presenceSummary")}</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label={t("presenceGuaranteedHours")}
          value={formatPresenceDuration(guaranteedMinutes(data.timeline.windows), t)}
          hint={t("securedTime")}
          icon={ClockIcon}
        />
        <StatCard
          label={t("presenceProvisionalHours")}
          value={formatPresenceDuration(provisionalMinutes(data.timeline.windows), t)}
          hint={t("provisionalWindow")}
        />
      </div>
      <div className="border-t pt-5">
        <div className="mb-4">
          <h3 className="text-balance font-medium">{t("presenceTimeline")}</h3>
          <p className="text-muted-foreground text-pretty mt-1 text-sm">
            {t("presenceTimelineFooter")}
          </p>
        </div>
        <PresenceTimeline
          data={data.timeline}
          canEdit={canEdit}
          onEdit={(signal) => {
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
          onDelete={(signal) => {
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
          onResolve={setResolvingConflict}
        />
      </div>
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
      {resolvingConflict && (
        <PresenceSignalModal
          userId={userId}
          activities={data.timeline.activities}
          conflict={resolvingConflict}
          onClose={() => setResolvingConflict(null)}
          onSaved={() => {
            setResolvingConflict(null);
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

function formatPresenceDuration(minutes: number, t: ReturnType<typeof useLocale>["t"]): string {
  if (minutes < 60) return t("presenceMinutesValue", { minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? t("presenceWholeHoursValue", { hours })
    : t("presenceHoursMinutesValue", { hours, minutes: remainder });
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
          <Label htmlFor="edit-presence-notes">{t("notesLabel")}</Label>
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
  const { language, t } = useLocale();
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
        time: formatUserDate(log.scannedAt, language),
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
  conflict,
  onClose,
  onSaved,
}: {
  userId: number;
  activities: PresenceTimelineData["activities"];
  signal?: PresenceTimelineSignal;
  conflict?: PresenceConflict;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { language, t } = useLocale();
  const editingActivity = signal?.source === "activity";
  const resolvingConflict = Boolean(conflict);
  const bounds = conflict ? conflictBounds(conflict) : null;
  const conflictDateTime = new Intl.DateTimeFormat(LOCALE_CODES[language], {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
  const [kind, setKind] = useState<"in" | "out" | "activity">(
    resolvingConflict ? "out" : editingActivity ? "activity" : "in",
  );
  const [activityId, setActivityId] = useState(
    signal?.activityId ? String(signal.activityId) : activities[0] ? String(activities[0].id) : "",
  );
  const [occurredAt, setOccurredAt] = useState(
    signal
      ? toDatetimeLocal(signal.occurredAt)
      : conflict && bounds
        ? toDatetimeLocal(
            new Date((bounds.min.getTime() + bounds.max.getTime()) / 2).toISOString(),
            true,
          )
        : toDatetimeLocal(new Date().toISOString()),
  );
  const [notes, setNotes] = useState(signal?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (!occurredAt || (kind === "activity" && !activityId)) return;
    const occurredAtDate = new Date(occurredAt);
    if (
      bounds &&
      (Number.isNaN(occurredAtDate.getTime()) ||
        occurredAtDate <= bounds.min ||
        occurredAtDate >= bounds.max)
    ) {
      setError(t("presenceConflictTimeInvalid"));
      return;
    }
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
      title={
        resolvingConflict
          ? t("presenceResolveConflict")
          : editingActivity
            ? t("editPresenceActivity")
            : t("addPresenceSignal")
      }
      description={
        resolvingConflict && conflict
          ? t("presenceConflictBounds", {
              from: conflictDateTime.format(bounds?.min ?? new Date(conflict.from)),
              to: conflictDateTime.format(bounds?.max ?? new Date(conflict.to)),
            })
          : t("presenceSignalFormDesc")
      }
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
                {!resolvingConflict && <SelectItem value="in">{t("entryOption")}</SelectItem>}
                <SelectItem value="activity">{t("activitySignal")}</SelectItem>
                <SelectItem value="out">{t("exitOption")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {kind === "activity" && (
          <div className="space-y-2">
            <Label htmlFor="presence-activity">{t("columnActivity")}</Label>
            <EntityCombobox
              id="presence-activity"
              inDialog
              options={activities}
              value={activityId}
              onChange={setActivityId}
              getId={(activity) => activity.id}
              getLabel={(activity) => `${activity.name} · ${activity.category}`}
              placeholder={t("chooseActivityOption")}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="presence-signal-time">{t("timeLabel")}</Label>
          <DateTimeInput
            id="presence-signal-time"
            value={occurredAt}
            min={bounds ? toDatetimeLocal(bounds.min.toISOString(), true) : undefined}
            max={toDatetimeLocal((bounds?.max ?? new Date()).toISOString(), Boolean(bounds))}
            step={bounds ? 1 : undefined}
            onChange={setOccurredAt}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="presence-signal-notes">{t("notesLabel")}</Label>
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
  const { language, t } = useLocale();
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
        time: formatUserDate(signal.occurredAt, language),
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
