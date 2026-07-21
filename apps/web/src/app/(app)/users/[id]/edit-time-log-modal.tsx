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
import { logisticsApi, type TimeLogEntry } from "@/lib/logistics";
import { toDatetimeLocal } from "./datetime-format";

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
