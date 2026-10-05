"use client";

import { MegaphoneIcon } from "@phosphor-icons/react/dist/csr/Megaphone";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

type Localized = Record<"en" | "es" | "gl", string>;
const empty: Localized = { en: "", es: "", gl: "" };
const languageKeys = {
  en: "challengeAlertLanguageEn",
  es: "challengeAlertLanguageEs",
  gl: "challengeAlertLanguageGl",
} as const;

export function ChallengeAlertDialog({
  challengeId,
  canTargetParticipants,
}: {
  challengeId: number;
  canTargetParticipants: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState<Localized>(empty);
  const [body, setBody] = useState<Localized>(empty);
  const [allParticipants, setAllParticipants] = useState(false);
  const [sending, setSending] = useState(false);
  const complete =
    Object.values(title).every((value) => value.trim()) &&
    Object.values(body).every((value) => value.trim());

  async function send() {
    if (!complete) return;
    setSending(true);
    try {
      const result = await api.post<{ recipients: number }>(
        `/api/challenges/${challengeId}/alerts`,
        {
          title,
          body,
          target: allParticipants ? "participants" : "challenge",
        },
        { headers: { "idempotency-key": crypto.randomUUID() } },
      );
      toast.success(t("challengeAlertSent", { count: result.recipients }), {
        compactTitle: t("sendChallengeAlert"),
      });
      setOpen(false);
      setTitle(empty);
      setBody(empty);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : t("couldNotSendChallengeAlert"),
        t("sendChallengeAlert"),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <MegaphoneIcon aria-hidden="true" className="size-4" />
        {t("sendChallengeAlert")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("sendChallengeAlert")}</DialogTitle>
          <DialogDescription>{t("challengeAlertRecipients")}</DialogDescription>
        </DialogHeader>
        {canTargetParticipants && (
          <label className="flex items-center gap-2 text-sm" htmlFor="alert-all-participants">
            <Checkbox
              checked={allParticipants}
              id="alert-all-participants"
              onCheckedChange={(checked) => setAllParticipants(checked === true)}
            />
            {t("challengeAlertAllParticipants")}
          </label>
        )}
        <div className="space-y-4 overflow-y-auto pr-1">
          {(["en", "es", "gl"] as const).map((language) => (
            <fieldset className="space-y-2" key={language}>
              <legend className="type-label">{t(languageKeys[language])}</legend>
              <Label htmlFor={`alert-title-${language}`}>{t("challengeAlertTitle")}</Label>
              <Input
                id={`alert-title-${language}`}
                onChange={(event) =>
                  setTitle((value) => ({ ...value, [language]: event.target.value }))
                }
                value={title[language]}
              />
              <Label htmlFor={`alert-body-${language}`}>{t("messageLabel")}</Label>
              <Textarea
                id={`alert-body-${language}`}
                onChange={(event) =>
                  setBody((value) => ({ ...value, [language]: event.target.value }))
                }
                value={body[language]}
              />
            </fieldset>
          ))}
        </div>
        <DialogFooter>
          <Button disabled={sending || !complete} onClick={send} loading={sending}>
            {sending ? t("sending") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
