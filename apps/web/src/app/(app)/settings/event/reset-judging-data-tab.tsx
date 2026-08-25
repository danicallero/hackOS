"use client";

import type { LucideIcon } from "lucide-react";
import { TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

const SERVER_CONFIRMATION_PHRASE = "WIPE_Q_DATA";
type ResetStage = 0 | 1 | 2 | 3;

/** H16-H40/H53: the event-wide project/import/queue/judging recovery control. */
export function ResetJudgingDataTab({ icon: Icon }: { icon: LucideIcon }) {
  const { t } = useLocale();
  const [stage, setStage] = useState<ResetStage>(0);
  const [phrase, setPhrase] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [pending, setPending] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const phraseId = useId();
  const phraseHelpId = useId();
  const acknowledgementId = useId();
  const errorId = useId();
  const phraseInputRef = useRef<HTMLInputElement>(null);
  const acknowledgementRef = useRef<HTMLButtonElement>(null);
  const phraseLabel = t("resetJudgingDataPhrase");

  function openReview() {
    setPhrase("");
    setAcknowledged(false);
    setValidationError(false);
    setResetComplete(false);
    setStage(1);
  }

  function closeFlow() {
    if (!pending) setStage(0);
  }

  function continueToFinalConfirmation() {
    const validPhrase = phrase.trim() === phraseLabel;
    if (!validPhrase || !acknowledged) {
      setValidationError(true);
      if (!validPhrase) phraseInputRef.current?.focus();
      else acknowledgementRef.current?.focus();
      return;
    }
    setValidationError(false);
    setStage(3);
  }

  async function wipeJudgingData() {
    setPending(true);
    try {
      await api.post<{ ok: true }>(
        "/api/queue/admin/reset",
        {
          confirmationPhrase: SERVER_CONFIRMATION_PHRASE,
          acknowledgeIrreversible: true,
        },
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      setPending(false);
      setStage(0);
      setResetComplete(true);
      toast.success(t("judgingDataReset"));
    } catch (err) {
      setPending(false);
      toast.error(err instanceof ApiError ? err.message : t("couldNotResetJudgingData"));
    }
  }

  return (
    <>
      <SectionCard
        icon={Icon}
        title={t("resetJudgingDataTitle")}
        description={t("resetJudgingDataDescription")}
        className="border-destructive/40"
      >
        <div className="space-y-4">
          <div className="rounded-md border border-destructive/35 bg-destructive/5 p-4">
            <p className="text-destructive text-sm font-medium">{t("resetJudgingDataWarning")}</p>
            <p className="text-muted-foreground mt-1 text-pretty text-sm">
              {t("resetJudgingDataUseOnlyWhenNeeded")}
            </p>
          </div>
          {resetComplete && (
            <p role="status" className="text-success text-sm">
              {t("judgingDataReset")}
            </p>
          )}
          <Button type="button" variant="destructive" onClick={openReview}>
            <TriangleAlertIcon />
            {t("reviewJudgingDataReset")}
          </Button>
        </div>
      </SectionCard>

      <AlertModal
        open={stage === 1}
        onOpenChange={(open) => !open && closeFlow()}
        title={t("resetJudgingDataFirstConfirmTitle")}
        description={t("resetJudgingDataFirstConfirmDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={t("continueToFinalConfirmation")}
        destructive
        reverseActions
        onConfirm={() => setStage(2)}
      >
        <div className="space-y-3">
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-pretty text-sm">
            <li>{t("resetJudgingDataDeletesProjects")}</li>
            <li>{t("resetJudgingDataDeletesQueueAndJudging")}</li>
            <li>{t("resetJudgingDataClearsChallengeMappings")}</li>
            <li>{t("resetJudgingDataPreservesEventSetup")}</li>
          </ul>
          <p className="text-destructive text-sm font-medium">{t("resetJudgingDataLastWarning")}</p>
        </div>
      </AlertModal>

      <Modal
        open={stage === 2}
        onOpenChange={(open) => !open && closeFlow()}
        title={t("resetJudgingDataSecondConfirmTitle")}
        description={t("resetJudgingDataSecondConfirmDescription")}
        icon={TriangleAlertIcon}
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeFlow}>
              {t("cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={continueToFinalConfirmation}>
              {t("continueToFinalConfirmation")}
            </Button>
          </>
        }
      >
        <div className="space-y-5 pb-1">
          <div className="space-y-2">
            <Label htmlFor={phraseId}>{t("resetJudgingDataPhraseLabel")}</Label>
            <Input
              id={phraseId}
              ref={phraseInputRef}
              value={phrase}
              onChange={(event) => {
                setPhrase(event.target.value);
                setValidationError(false);
              }}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              aria-invalid={validationError}
              aria-describedby={`${phraseHelpId}${validationError ? ` ${errorId}` : ""}`}
            />
            <p id={phraseHelpId} className="text-muted-foreground text-sm">
              {t("resetJudgingDataPhraseHelp", { phrase: phraseLabel })}
            </p>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id={acknowledgementId}
              ref={acknowledgementRef}
              checked={acknowledged}
              onCheckedChange={(checked) => {
                setAcknowledged(checked === true);
                setValidationError(false);
              }}
              aria-invalid={validationError}
              aria-describedby={validationError ? errorId : undefined}
              className="mt-0.5"
            />
            <Label htmlFor={acknowledgementId} className="text-pretty leading-5">
              {t("resetJudgingDataAcknowledge")}
            </Label>
          </div>

          {validationError && (
            <p id={errorId} role="alert" className="text-destructive text-sm">
              {t("resetJudgingDataValidation")}
            </p>
          )}
        </div>
      </Modal>

      <AlertModal
        open={stage === 3}
        onOpenChange={(open) => !open && closeFlow()}
        title={t("resetJudgingDataFinalTitle")}
        description={t("resetJudgingDataFinalDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={t("wipeJudgingData")}
        pending={pending}
        destructive
        reverseActions
        onConfirm={wipeJudgingData}
      >
        <p className="text-destructive text-pretty text-sm font-medium">
          {t("resetJudgingDataFinalWarning")}
        </p>
      </AlertModal>
    </>
  );
}
