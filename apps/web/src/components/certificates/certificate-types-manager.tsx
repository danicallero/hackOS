"use client";

import { CertificateIcon } from "@phosphor-icons/react/dist/csr/Certificate";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import {
  type CertificateType,
  type CertificateTypeInput,
  certificateTypesApi,
} from "@/lib/certificates";
import { LANGS, languageName, type MessageKey, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { IssuedCertificates } from "./issued-certificates";

const blank = () => ({ es: "", gl: "", en: "" });
const newDefinition = (): CertificateTypeInput => ({
  name: blank(),
  title: blank(),
  body: blank(),
  enabled: true,
  attendancePolicy: false,
  selfService: false,
  audienceRoleIds: null,
  allowGuests: false,
  identityPolicy: "optional",
  requiresActivity: false,
});
const FIELDS: [string, MessageKey][] = [
  ["recipient", "certificateFieldRecipient"],
  ["event", "certificateFieldEvent"],
  ["issuer", "certificateIssuerName"],
  ["activity", "certificateTalkActivity"],
  ["hours", "certificateCertifiedHours"],
  ["dates", "certificateFieldDates"],
  ["venue", "certificateFieldVenue"],
];

/** #1083: editable definitions and the guest register are owned by Event settings. */
export function CertificateTypesManager() {
  const { t, language } = useLocale();
  const catalog = useServerResource(["certificate-types"], certificateTypesApi.list);
  const [editing, setEditing] = useState<CertificateType | null | undefined>(undefined);
  const columns: Column<CertificateType>[] = [
    { id: "name", header: t("certificateType"), cell: (type) => type.name[language] },
    {
      id: "recipients",
      header: t("certificateRecipients"),
      cell: (type) =>
        type.legacyVariant === "accepted_spot"
          ? t("certificateAllEventAccess")
          : type.audienceRoleIds == null
            ? t("certificateAllAccounts")
            : type.audienceRoleIds
                .map((id) => catalog.data?.roles.find((r) => r.id === id)?.name)
                .filter(Boolean)
                .join(", ") || t("certificateNoRecipientRoles"),
    },
    {
      id: "status",
      header: t("statusColumn"),
      cell: (type) => t(type.enabled ? "certificateTypeEnabled" : "certificateTypeDisabled"),
    },
  ];
  return (
    <div className="mt-8 space-y-8">
      <SectionCard
        variant="plain"
        icon={CertificateIcon}
        title={t("certificateTypes")}
        action={
          <Button onClick={() => setEditing(null)}>
            <PlusIcon />
            {t("certificateCreateType")}
          </Button>
        }
      >
        <DataTable
          columns={columns}
          data={catalog.data?.items ?? []}
          getRowId={(type) => String(type.id)}
          loading={catalog.loading}
          error={
            catalog.error
              ? {
                  message: apiErrorText(catalog.error, t, t("couldNotLoadCertificates")),
                  onRetry: catalog.reload,
                }
              : undefined
          }
          rowActions={(type) => (
            <Button variant="outline" size="sm" onClick={() => setEditing(type)}>
              {t("edit")}
            </Button>
          )}
        />
      </SectionCard>
      <IssuedCertificates />
      <Modal
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={t(editing ? "certificateEditType" : "certificateCreateType")}
        size="lg"
      >
        {editing !== undefined && (
          <DefinitionEditor
            key={editing?.id ?? "new"}
            original={editing}
            roles={catalog.data?.roles ?? []}
            onSaved={() => {
              catalog.reload();
              setEditing(undefined);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
function DefinitionEditor({
  original,
  roles,
  onSaved,
}: {
  original: CertificateType | null;
  roles: { id: number; name: string }[];
  onSaved: () => void;
}) {
  const { t, language } = useLocale();
  const [draft, setDraft] = useState<CertificateTypeInput>(
    original ? { ...original } : newDefinition(),
  );
  const acceptedSpot = original?.legacyVariant === "accepted_spot";
  const [locale, setLocale] = useState<Language>(language);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  function patch(value: Partial<CertificateTypeInput>) {
    setDraft((d) => ({ ...d, ...value }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    for (const lang of LANGS)
      if (
        !draft.name[lang].trim() ||
        !draft.title[lang].trim() ||
        (draft.body && !draft.body[lang].trim())
      ) {
        setLocale(lang);
        setError(t("certificateTranslationsRequired"));
        return;
      }
    setPending(true);
    try {
      const {
        name,
        title,
        body,
        enabled,
        attendancePolicy,
        selfService,
        audienceRoleIds,
        allowGuests,
        identityPolicy,
        requiresActivity,
      } = draft;
      const definition = {
        name,
        title,
        body,
        enabled,
        attendancePolicy,
        selfService,
        audienceRoleIds,
        allowGuests,
        identityPolicy,
        requiresActivity,
      };
      if (original) await certificateTypesApi.update(original.id, original.revision, definition);
      else await certificateTypesApi.create(definition);
      onSaved();
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotSaveEventSettings")));
    } finally {
      setPending(false);
    }
  }
  const toggle = (
    key: "enabled" | "attendancePolicy" | "selfService" | "allowGuests" | "requiresActivity",
    label: MessageKey,
  ) => (
    <div className="flex items-center gap-2">
      <Checkbox
        id={`type-${key}`}
        checked={draft[key]}
        disabled={
          (acceptedSpot && key !== "enabled") || (key === "selfService" && draft.requiresActivity)
        }
        onCheckedChange={(value) =>
          patch({
            [key]: value === true,
            ...(key === "requiresActivity" && value === true ? { selfService: false } : {}),
          })
        }
      />
      <Label htmlFor={`type-${key}`}>{t(label)}</Label>
    </div>
  );
  return (
    <form onSubmit={(event) => void save(event)} className="space-y-5">
      {error && <ContextualError message={error} />}
      <fieldset disabled={pending} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="type-language">{t("language")}</Label>
          <Select value={locale} onValueChange={(v) => setLocale(v as Language)}>
            <SelectTrigger id="type-language" className="w-full">
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
        <div className="space-y-2">
          <Label htmlFor="type-name">{t("certificateTypeName")}</Label>
          <Input
            id="type-name"
            value={draft.name[locale]}
            onChange={(e) => patch({ name: { ...draft.name, [locale]: e.target.value } })}
            maxLength={500}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="type-title">{t("certificateDocumentTitle")}</Label>
          <Input
            id="type-title"
            value={draft.title[locale]}
            onChange={(e) => patch({ title: { ...draft.title, [locale]: e.target.value } })}
            maxLength={500}
            required
          />
        </div>
        {original?.legacyVariant && !acceptedSpot && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="type-custom-text"
              checked={draft.body !== null}
              onCheckedChange={(value) => patch({ body: value === true ? blank() : null })}
            />
            <Label htmlFor="type-custom-text">{t("certificateCustomWording")}</Label>
          </div>
        )}
        {draft.body && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="type-body">{t("certificateDocumentText")}</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    {t("certificateInsertField")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {FIELDS.map(([field, label]) => (
                    <DropdownMenuItem
                      key={field}
                      onSelect={() =>
                        patch({
                          body: {
                            ...draft.body!,
                            [locale]: `${draft.body?.[locale] ?? ""}{${field}}`,
                          },
                        })
                      }
                    >
                      {t(label)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Textarea
              id="type-body"
              value={draft.body[locale]}
              onChange={(e) => patch({ body: { ...draft.body!, [locale]: e.target.value } })}
              maxLength={12000}
              rows={6}
              required
            />
          </div>
        )}
        {toggle("enabled", "certificateTypeEnabled")}
        {toggle("attendancePolicy", "certificateUseAttendancePolicy")}
        {toggle("selfService", "certificateSelfService")}
        {acceptedSpot && <p className="text-sm">{t("certificateAllEventAccess")}</p>}
        {!acceptedSpot && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="type-all-accounts"
              checked={draft.audienceRoleIds === null}
              onCheckedChange={(v) => patch({ audienceRoleIds: v === true ? null : [] })}
            />
            <Label htmlFor="type-all-accounts">{t("certificateAllAccounts")}</Label>
          </div>
        )}
        {draft.audienceRoleIds !== null && (
          <div className="space-y-2">
            <Label htmlFor="type-role-ids">{t("certificateRecipientRoles")}</Label>
            <MultiSelect
              id="type-role-ids"
              options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
              value={draft.audienceRoleIds.map(String)}
              onChange={(ids) => patch({ audienceRoleIds: ids.map(Number) })}
            />
          </div>
        )}
        {toggle("allowGuests", "certificateAllowGuests")}
        {toggle("requiresActivity", "certificateRequiresTalk")}
        <div className="space-y-2">
          <Label htmlFor="type-identity-policy">{t("certificateIdentificationPolicy")}</Label>
          <Select
            value={draft.identityPolicy}
            onValueChange={(v) =>
              patch({ identityPolicy: v as CertificateTypeInput["identityPolicy"] })
            }
          >
            <SelectTrigger id="type-identity-policy" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("certificateNameOnly")}</SelectItem>
              <SelectItem value="optional">{t("certificateIdOptional")}</SelectItem>
              <SelectItem value="required">{t("certificateIdRequired")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </fieldset>
      <SubmitButton pending={pending}>{t("saveChanges")}</SubmitButton>
    </form>
  );
}
