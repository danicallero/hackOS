"use client";

// H52: individual email notice from the no-reply sender, to check delivery and
// rendering. Gated by notifications:send; POST /api/notifications/test-email.

import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { useState } from "react";
import { Modal } from "@/components/common/modal";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

export function TestEmailModal() {
  const { t, language } = useLocale();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      await api.post("/api/notifications/test-email", { to, subject, body, language });
      toast.success(t("testEmailSent", { to }), { compactTitle: t("sendEmail") });
      setOpen(false);
      setSubject("");
      setBody("");
    } catch (err) {
      toast.error(apiErrorText(err, t, t("couldNotSendTestEmail")), t("sendEmail"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
      trigger={
        <Button variant="outline">
          <EnvelopeSimpleIcon aria-hidden="true" className="size-4" />
          {t("sendEmail")}
        </Button>
      }
      title={t("sendEmail")}
      icon={EnvelopeSimpleIcon}
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <SubmitButton
            pending={pending}
            onClick={submit}
            disabled={!to.includes("@") || !subject.trim() || !body.trim()}
          >
            {t("send")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="test-email-to">{t("email")}</Label>
          <Input
            id="test-email-to"
            type="email"
            autoComplete="off"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="test-email-subject">{t("titleLabel")}</Label>
          <Input
            id="test-email-subject"
            value={subject}
            maxLength={200}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="test-email-body">{t("messageLabel")}</Label>
          <Textarea
            id="test-email-body"
            rows={6}
            value={body}
            maxLength={5000}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
