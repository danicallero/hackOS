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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import {
  type CertificateType,
  type CertificateTypeInput,
  certificateTypesApi,
} from "@/lib/certificates";
import { LANGS, type MessageKey, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";

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
  requiresEventEnd: false,
  demoRequirement: "none",
  demoChallengeId: null,
  exemptRoleIds: null,
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

/** #1083: editable certificate definitions, owned by Event settings. */
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
    <>
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
            challenges={catalog.data?.challenges ?? []}
            onSaved={() => {
              catalog.reload();
              setEditing(undefined);
            }}
          />
        )}
      </Modal>
    </>
  );
}
function DefinitionEditor({
  original,
  roles,
  challenges,
  onSaved,
}: {
  original: CertificateType | null;
  roles: { id: number; name: string }[];
  challenges: { id: number; title: string; mandatory: boolean }[];
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
        requiresEventEnd,
        demoRequirement,
        demoChallengeId,
        exemptRoleIds,
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
        requiresEventEnd,
        demoRequirement,
        demoChallengeId: demoRequirement === "challenge" ? demoChallengeId : null,
        exemptRoleIds: exemptRoleIds?.length ? exemptRoleIds : null,
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
    key:
      | "enabled"
      | "attendancePolicy"
      | "selfService"
      | "allowGuests"
      | "requiresActivity"
      | "requiresEventEnd",
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
        <h3 className="font-medium">{t("certificateEditorWording")}</h3>
        <Tabs value={locale} onValueChange={(v) => setLocale(v as Language)}>
          <TabsList aria-label={t("language")}>
            {LANGS.map((lang) => (
              <TabsTrigger key={lang} value={lang}>
                {lang.toUpperCase()}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
        <section className="space-y-3">
          <h3 className="font-medium">{t("certificateEditorRecipients")}</h3>
          {toggle("enabled", "certificateTypeEnabled")}
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
        </section>
        <section className="space-y-3">
          <h3 className="font-medium">{t("certificateEditorRules")}</h3>
          {toggle("attendancePolicy", "certificateUseAttendancePolicy")}
          {toggle("requiresActivity", "certificateRequiresTalk")}
          {toggle("requiresEventEnd", "certificateRequiresEventEnd")}
          <div className="space-y-2">
            <Label htmlFor="type-demo-requirement">{t("certificateDemoRequirement")}</Label>
            <Select
              value={draft.demoRequirement}
              disabled={acceptedSpot}
              onValueChange={(v) =>
                patch({
                  demoRequirement: v as CertificateTypeInput["demoRequirement"],
                  demoChallengeId: v === "challenge" ? (challenges[0]?.id ?? null) : null,
                })
              }
            >
              <SelectTrigger id="type-demo-requirement" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="none">{t("certificateDemoNone")}</SelectItem>
                <SelectItem value="any">{t("certificateDemoAny")}</SelectItem>
                <SelectItem value="mandatory">{t("certificateDemoMandatory")}</SelectItem>
                <SelectItem value="challenge">{t("certificateDemoChallenge")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.demoRequirement === "challenge" && (
            <Select
              value={draft.demoChallengeId == null ? "" : String(draft.demoChallengeId)}
              onValueChange={(v) => patch({ demoChallengeId: Number(v) })}
            >
              <SelectTrigger aria-label={t("certificateDemoChallenge")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {challenges.map((challenge) => (
                  <SelectItem key={challenge.id} value={String(challenge.id)}>
                    {challenge.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!acceptedSpot && (
            <div className="space-y-2">
              <Label htmlFor="type-exempt-roles">{t("certificateExemptRoles")}</Label>
              <MultiSelect
                id="type-exempt-roles"
                options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
                value={(draft.exemptRoleIds ?? []).map(String)}
                onChange={(ids) => patch({ exemptRoleIds: ids.map(Number) })}
              />
            </div>
          )}
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
              <SelectContent position="popper">
                <SelectItem value="none">{t("certificateNameOnly")}</SelectItem>
                <SelectItem value="optional">{t("certificateIdOptional")}</SelectItem>
                <SelectItem value="required">{t("certificateIdRequired")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>
      </fieldset>
      <SubmitButton pending={pending}>{t("saveChanges")}</SubmitButton>
    </form>
  );
}
