"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { SubmitButton } from "@/components/common/submit-button";
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
import { useLocale } from "@/lib/i18n";
import {
  logisticsApi,
  type PresenceTimelineData,
  type PresenceTimelineSignal,
} from "@/lib/logistics";
import { toDatetimeLocal } from "./datetime-format";

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
