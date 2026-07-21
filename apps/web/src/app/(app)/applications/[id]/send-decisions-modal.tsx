"use client";

// Batch send decisions (H14).

import { SendIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/common/modal";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

export function SendDecisionsModal({
  id,
  open,
  onOpenChange,
  onSent,
}: {
  id: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [includeRejected, setIncludeRejected] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      // POST /api/applications/:id/send-decisions (APPLICATIONS_DECIDE) — sends
      // every accepted_internal (and optionally rejected_internal) decision not
      // yet sent (H14). Returns { sent, tokens }.
      const { sent, tokens } = await api.post<{
        sent: number;
        tokens: Array<{ responseId: number; token: string | null }>;
      }>(`/api/applications/${id}/send-decisions`, {
        include_rejected: includeRejected,
      });
      await onSent();
      const tokenCount = tokens.filter((tok) => tok.token).length;
      const msg =
        sent === 0
          ? t("nothingLeftToSend")
          : tokenCount > 0
            ? t("sentDecisionsWithLinks", { sent, tokenCount })
            : t("sentDecisions", { sent });
      toast.success(msg);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSendDecisions"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      icon={SendIcon}
      title={t("sendDecisions")}
      description={t("sendDecisionsDesc")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={busy} onClick={send}>
            {busy && <Spinner />}
            {t("sendNow")}
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="text-sm">{t("includeRejectionsLabel")}</Label>
          <p className="text-muted-foreground text-xs">{t("includeRejectionsDesc")}</p>
        </div>
        <Switch checked={includeRejected} onCheckedChange={setIncludeRejected} />
      </div>
    </Modal>
  );
}
