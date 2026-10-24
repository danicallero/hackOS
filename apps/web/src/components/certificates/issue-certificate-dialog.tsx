"use client";

import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { Modal } from "@/components/common/modal";
import { SubmitButton } from "@/components/common/submit-button";
import { UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { type Certificate, certificateTypesApi } from "@/lib/certificates";
import { LANGS, languageName, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

/** #1083: account or named guest; a guest remains in the settings register. */
export function IssueCertificateDialog({
  userId,
  onIssued,
}: {
  userId?: number;
  onIssued?: () => void;
}) {
  const { t, language } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PlusIcon />
        {t("certificateIssueConfigured")}
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={t("certificateIssueConfigured")} size="lg">
        {open && <IssueForm userId={userId} initialLanguage={language} onIssued={onIssued} />}
      </Modal>
    </>
  );
}
function IssueForm({
  userId,
  initialLanguage,
  onIssued,
}: {
  userId?: number;
  initialLanguage: Language;
  onIssued?: () => void;
}) {
  const { t, language } = useLocale();
  const types = useServerResource(["certificate-types"], certificateTypesApi.list);
  const [typeId, setTypeId] = useState("");
  const [recipient, setRecipient] = useState(userId == null ? "" : String(userId));
  const [guest, setGuest] = useState(false);
  const [name, setName] = useState("");
  const [activity, setActivity] = useState("");
  const [locale, setLocale] = useState<Language>(initialLanguage);
  const [documentKind, setDocumentKind] = useState<"dni_nie" | "passport">("dni_nie");
  const [documentNumber, setDocumentNumber] = useState("");
  const [includeId, setIncludeId] = useState(false);
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Certificate | null>(null);
  const enabled = types.data?.items.filter((type) => type.enabled) ?? [];
  const selected = enabled.find((type) => String(type.id) === typeId);
  const identity =
    selected?.identityPolicy === "required" ||
    (selected?.identityPolicy === "optional" && includeId);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setError(null);
    setPending(true);
    try {
      const result = await certificateTypesApi.issue({
        typeId: selected.id,
        locale,
        ...(guest ? { guestName: name.trim() } : { userId: Number(recipient) }),
        ...(activity.trim() ? { activityName: activity.trim() } : {}),
        ...(hours.trim() ? { certifiedHours: Number(hours) } : {}),
        ...(reason.trim() ? { overrideReason: reason.trim() } : {}),
        includeIdentification: identity,
        ...(identity && documentNumber.trim()
          ? { documentKind, documentNumber: documentNumber.trim() }
          : {}),
      });
      setIssued(result);
      onIssued?.();
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotUseCertificate")));
    } finally {
      setPending(false);
    }
  }
  if (issued)
    return (
      <div className="space-y-4">
        <p>{t("certificateIssuedToast")}</p>
        <p className="text-sm text-muted-foreground">{t("certificateGuestRegisterHelp")}</p>
        <Button variant="outline" onClick={() => setIssued(null)}>
          {t("certificateIssueAnother")}
        </Button>
      </div>
    );
  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      {error && <ContextualError message={error} />}{" "}
      {Boolean(types.error) && (
        <ContextualError
          message={apiErrorText(types.error, t, t("couldNotLoadCertificates"))}
          onRetry={types.reload}
        />
      )}
      <fieldset disabled={pending} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="issue-certificate-type">{t("certificateType")}</Label>
          <EntityCombobox
            id="issue-certificate-type"
            inDialog
            options={enabled}
            value={typeId}
            onChange={(id) => {
              setTypeId(id);
              setIssued(null);
              setGuest(false);
              setDocumentNumber("");
              setIncludeId(false);
              setHours("");
              setReason("");
              setActivity("");
            }}
            getId={(type) => type.id}
            getLabel={(type) => type.name[language]}
          />
        </div>
        {selected?.allowGuests && userId == null && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="issue-guest"
              checked={guest}
              onCheckedChange={(v) => setGuest(v === true)}
            />
            <Label htmlFor="issue-guest">{t("certificateGuestRecipient")}</Label>
          </div>
        )}
        {guest ? (
          <div className="space-y-2">
            <Label htmlFor="issue-recipient-name">{t("certificateRecipientName")}</Label>
            <Input
              id="issue-recipient-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={400}
              required
            />
          </div>
        ) : userId == null ? (
          <div className="space-y-2">
            <Label htmlFor="issue-recipient-account">{t("certificateRecipientAccount")}</Label>
            <UserPicker
              id="issue-recipient-account"
              inDialog
              value={recipient}
              onChange={setRecipient}
              search={async (q) =>
                (
                  await api.get<{ items: import("@/components/common/user-picker").UserOption[] }>(
                    "/api/certificates/recipients",
                    { query: { q } },
                  )
                ).items
              }
            />
          </div>
        ) : null}
        {selected?.requiresActivity && (
          <div className="space-y-2">
            <Label htmlFor="issue-activity">{t("certificateTalkActivity")}</Label>
            <Input
              id="issue-activity"
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              maxLength={500}
              required
            />
          </div>
        )}
        {selected?.identityPolicy === "optional" && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="issue-identification"
              checked={includeId}
              onCheckedChange={(v) => setIncludeId(v === true)}
            />
            <Label htmlFor="issue-identification">{t("certificateIncludeIdentification")}</Label>
          </div>
        )}
        {identity && (
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="issue-document-kind">{t("certificateDocumentKind")}</Label>
              <Select
                value={documentKind}
                onValueChange={(v) => setDocumentKind(v as typeof documentKind)}
              >
                <SelectTrigger id="issue-document-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dni_nie">DNI/NIE</SelectItem>
                  <SelectItem value="passport">{t("certificatePassport")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="issue-document-number">{t("certificateDocumentNumber")}</Label>
              <Input
                id="issue-document-number"
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                maxLength={100}
                required={guest}
              />
            </div>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="issue-certificate-language">{t("language")}</Label>
          <Select value={locale} onValueChange={(v) => setLocale(v as Language)}>
            <SelectTrigger id="issue-certificate-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGS.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {languageName(lang)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selected?.legacyVariant !== "accepted_spot" && (
          <div className="space-y-2">
            <Label htmlFor="issue-certificate-hours">{t("certificateCertifiedHours")}</Label>
            <Input
              id="issue-certificate-hours"
              type="number"
              min={0.01}
              max={999}
              step={0.01}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="max-w-48 tabular-nums"
            />
          </div>
        )}
        {selected?.attendancePolicy && hours.trim() && (
          <div className="space-y-2">
            <Label htmlFor="issue-certificate-reason">{t("certificateOverrideReason")}</Label>
            <Input
              id="issue-certificate-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              required
            />
          </div>
        )}
      </fieldset>
      <SubmitButton
        pending={pending}
        disabled={!selected || (!guest && !recipient) || (guest && !name.trim())}
      >
        {t("certificateIssueAction")}
      </SubmitButton>
    </form>
  );
}
