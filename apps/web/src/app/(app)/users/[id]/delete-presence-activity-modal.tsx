"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { errorMessage, InlineError } from "@/components/logistics/ui";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type PresenceTimelineSignal } from "@/lib/logistics";
import { timeFmt } from "./datetime-format";

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
