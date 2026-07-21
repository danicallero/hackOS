"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { errorMessage } from "@/components/logistics/ui";
import { useLocale } from "@/lib/i18n";
import { logisticsApi, type TimeLogEntry } from "@/lib/logistics";
import { timeFmt } from "./datetime-format";

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
