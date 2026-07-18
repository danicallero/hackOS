"use client";

// Application form detail (H11–H15). Up to four tabs, gated per capability:
//   • Form (applications:manage) — edit metadata (window, quota, type) and a
//     questions editor (add/remove/reorder template fields with i18n labels).
//     Persists via PATCH /api/applications/:id.
//   • Review (applications:review) — submitted responses: my-review score/
//     notes, shared staff-notes, and (for deciders) the accept/reject call.
//   • Outbox / Sent decisions (applications:decide) — internal decisions not
//     yet sent vs. every already-communicated final status, with
//     send/resend/re-accept/revoke/confirm-override actions gated by each
//     row's actual status (see ../workflow.ts). Optional stats strip needs
//     logistics:stats.
//
// NOTE: the applications template uses templateFieldSchema (FIELD_KINDS), not
// the judging questionSchema. i18n labels carry {en,es,gl} (plan/07 §2).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckCheckIcon,
  ClipboardListIcon,
  EyeIcon,
  FileTextIcon,
  ListChecksIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SendIcon,
  SettingsIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EmptyState } from "@/components/common/empty-state";
import { FileLink } from "@/components/common/file-link";
import { Modal } from "@/components/common/modal";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { pickText, type Translate, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { useCan, useMe } from "@/lib/session";
import type { Intolerance, Language } from "@/lib/types";
import {
  APPLICATION_TYPES,
  type ApplicationForm,
  type ApplicationStats,
  FIELD_KINDS,
  FILE_KIND,
  type FieldKind,
  fmtDateTime,
  fmtScore,
  fromLocalInput,
  type I18nText,
  OPTION_KINDS,
  type ResponseRow,
  SHIRT_TYPES,
  statusTone,
  type TemplateField,
  toLocalInput,
  windowState,
} from "../lib";
import {
  type ApplicationWorkspace,
  applicationStatusLabel,
  generatedFieldKey,
  rowsForWorkspace,
  statusesForWorkspace,
} from "../workflow";

const LOCALES = ["es", "en", "gl"] as const;
const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };

export default function ApplicationDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);

  const [form, setForm] = useState<ApplicationForm | null>(null);
  const [stats, setStats] = useState<ApplicationStats | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const loadForm = useCallback(async () => {
    try {
      // Metadata is behind applications:manage. A reviewer without it falls back
      // to the public template (works only while the form window is open) so
      // answers can still render by label; otherwise raw keys are shown.
      const data = canManage
        ? await api.get<ApplicationForm>(`/api/applications/${id}`)
        : await api.get<ApplicationForm>(`/api/public/applications/${id}`);
      setForm(data);
      setState("ready");
    } catch (err) {
      if (!canManage) {
        // Reviewer on a closed form: no template, but responses still load.
        setForm(null);
        setState("ready");
        return;
      }
      setErrorMsg(err instanceof ApiError ? err.message : t("couldNotLoadForm"));
      setState("error");
    }
  }, [id, canManage, t]);

  // Soft, in-place refresh instead of a hard reload when someone else edits
  // this form, its questions, or a response changes its stats elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (Number.isFinite(id)) void loadForm();
    else setState("error");
  }, [id, loadForm, liveRefresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!canStats || !Number.isFinite(id)) return;
    api
      .get<ApplicationStats>(`/api/applications/${id}/stats`)
      .then(setStats)
      .catch(() => setStats(null));
  }, [id, canStats, liveRefresh]);

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState
          icon={ClipboardListIcon}
          title={t("formNotFound")}
          description={errorMsg || t("formCouldNotBeLoaded")}
        />
      </div>
    );
  }

  const defaultTab = canManage ? "builder" : canReview ? "review" : "outbox";
  const w = form ? windowState(form, t) : null;

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {form ? form.name : t("applicationNumber", { id })}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {form && (
              <>
                <StatusBadge tone="neutral" className="capitalize">
                  {form.type}
                </StatusBadge>
                {w && (
                  <StatusBadge tone={w.tone} dot={false}>
                    {w.label}
                  </StatusBadge>
                )}
                {form.capacity != null && (
                  <span className="text-muted-foreground text-xs">
                    {t("quotaInline", { capacity: form.capacity })}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {canStats && stats && <StatsStrip stats={stats} />}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto">
          {canManage && <TabsTrigger value="builder">{t("formTabLabel")}</TabsTrigger>}
          {canReview && <TabsTrigger value="review">{t("workspaceReview")}</TabsTrigger>}
          {canDecide && <TabsTrigger value="outbox">{t("workspaceOutbox")}</TabsTrigger>}
          {canDecide && <TabsTrigger value="sent">{t("workspaceSentDecisions")}</TabsTrigger>}
        </TabsList>

        {canManage && (
          <TabsContent value="builder" className="space-y-6 pt-2">
            {form ? (
              <>
                <MetadataCard form={form} onSaved={loadForm} />
                <QuestionsCard form={form} onSaved={loadForm} />
              </>
            ) : (
              <EmptyState
                icon={LockIcon}
                title={t("metadataUnavailable")}
                description={t("metadataUnavailableDesc")}
              />
            )}
          </TabsContent>
        )}

        {canReview && (
          <TabsContent value="review" className="pt-2">
            <ResponsesTab id={id} template={form?.template ?? null} workspace="review" />
          </TabsContent>
        )}
        {canDecide && (
          <TabsContent value="outbox" className="pt-2">
            <ResponsesTab id={id} template={form?.template ?? null} workspace="outbox" />
          </TabsContent>
        )}
        {canDecide && (
          <TabsContent value="sent" className="pt-2">
            <ResponsesTab id={id} template={form?.template ?? null} workspace="sent" />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function BackLink() {
  const { t } = useLocale();
  return (
    <Link
      href="/applications"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      {t("backToApplications")}
    </Link>
  );
}

// ── Stats strip (H27, logistics:stats) ────────────────────────────────────────

function StatsStrip({ stats }: { stats: ApplicationStats }) {
  const { t } = useLocale();
  const c = stats.counts_by_status;
  const nonDraft = Object.entries(c)
    .filter(([s]) => s !== "draft")
    .reduce((a, [, v]) => a + v, 0);
  const accepted = (c.accepted_internal ?? 0) + (c.accepted ?? 0);
  const acceptedUnsent = c.accepted_internal ?? 0;
  const acceptedSent = c.accepted ?? 0;
  const declined =
    (c.rejected_internal ?? 0) + (c.rejected ?? 0) + (c.declined ?? 0) + (c.expired ?? 0);
  const declinedUnsent = c.rejected_internal ?? 0;
  const declinedSent = c.rejected ?? 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t("responsesLabel")}
        value={String(nonDraft)}
        icon={UsersIcon}
        hint={t("nonDraftHint")}
      />
      <StatCard
        label={t("acceptedLabel")}
        value={String(accepted)}
        hint={t("unsentSentHint", { unsent: acceptedUnsent, sent: acceptedSent })}
      />
      <StatCard label={t("confirmed")} value={String(c.confirmed ?? 0)} />
      <StatCard
        label={t("declined")}
        value={String(declined)}
        hint={t("declinedHint", {
          unsent: declinedUnsent,
          sent: declinedSent,
          declined: c.declined ?? 0,
          expired: c.expired ?? 0,
        })}
      />
    </div>
  );
}

// ── Metadata editor (H11) ─────────────────────────────────────────────────────

const metaSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  type: z.enum(APPLICATION_TYPES),
  description: z.string(),
  active: z.boolean(),
  open_at: z.string(),
  close_at: z.string(),
  capacity: z.string(),
  confirmation_window_hours: z.string(),
});
type MetaValues = z.infer<typeof metaSchema>;

function MetadataCard({ form, onSaved }: { form: ApplicationForm; onSaved: () => Promise<void> }) {
  const { t } = useLocale();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const localizedMetaSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        type: z.enum(APPLICATION_TYPES),
        description: z.string(),
        active: z.boolean(),
        open_at: z.string(),
        close_at: z.string(),
        capacity: z.string(),
        confirmation_window_hours: z.string(),
      }),
    [t],
  );
  const rhf = useForm<MetaValues>({
    resolver: zodResolver(localizedMetaSchema),
    defaultValues: {
      name: form.name,
      type: form.type,
      description: form.description ?? "",
      active: form.active,
      open_at: toLocalInput(form.open_at),
      close_at: toLocalInput(form.close_at),
      capacity: form.capacity != null ? String(form.capacity) : "",
      confirmation_window_hours: String(form.confirmation_window_hours),
    },
  });

  async function onSubmit(values: MetaValues) {
    const capacityNum = values.capacity.trim() ? Number(values.capacity) : null;
    if (capacityNum !== null && (!Number.isInteger(capacityNum) || capacityNum < 1)) {
      rhf.setError("capacity", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    const windowHours = Number(values.confirmation_window_hours);
    if (!Number.isInteger(windowHours) || windowHours < 1) {
      rhf.setError("confirmation_window_hours", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    try {
      setSaveState("saving");
      // PATCH /api/applications/:id (APPLICATIONS_MANAGE) — audited server-side (H11/H53).
      await api.patch<ApplicationForm>(`/api/applications/${form.id}`, {
        name: values.name.trim(),
        type: values.type,
        description: values.description.trim() || null,
        active: values.active,
        open_at: fromLocalInput(values.open_at),
        close_at: fromLocalInput(values.close_at),
        capacity: capacityNum,
        confirmation_window_hours: windowHours,
      });
      await onSaved();
      rhf.reset(values);
      setSaveState("saved");
      toast.success(t("formUpdated"));
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveForm"));
    }
  }

  return (
    <Form {...rhf}>
      <form onSubmit={rhf.handleSubmit(onSubmit)}>
        <SectionCard
          icon={SettingsIcon}
          title={t("formSettings")}
          footer={
            <>
              <SaveStatus
                state={
                  rhf.formState.isSubmitting
                    ? "saving"
                    : saveState === "error"
                      ? "error"
                      : rhf.formState.isDirty
                        ? "unsaved"
                        : "saved"
                }
                className="mr-auto"
              />
              <SubmitButton pending={rhf.formState.isSubmitting}>{t("saveSettings")}</SubmitButton>
            </>
          }
        >
          <h3 className="text-balance text-sm font-semibold">{t("builderBasics")}</h3>
          <FormField
            control={rhf.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={rhf.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("personTypeLabel")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full capitalize">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {APPLICATION_TYPES.map((type) => (
                      <SelectItem key={type} value={type} className="capitalize">
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {SHIRT_TYPES.includes(field.value) && (
                  <FormDescription>{t("shirtSizeRequiredDesc")}</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={rhf.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("descriptionLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={2} placeholder={t("shownToApplicantsPlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <h3 className="border-t pt-4 text-balance text-sm font-semibold">
            {t("builderAvailability")}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={rhf.control}
              name="open_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("colOpens")}</FormLabel>
                  <FormControl>
                    <DateTimeInput
                      value={field.value}
                      onChange={field.onChange}
                      nullOption={{ label: t("openImmediately") }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={rhf.control}
              name="close_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("colCloses")}</FormLabel>
                  <FormControl>
                    <DateTimeInput
                      value={field.value}
                      onChange={field.onChange}
                      nullOption={{ label: t("neverCloses") }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={rhf.control}
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("colQuota")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder={t("unlimitedPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t("optionalCapDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={rhf.control}
              name="confirmation_window_hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("confirmWindowLabel")}</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} {...field} />
                  </FormControl>
                  <FormDescription>{t("hoursToConfirmDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <h3 className="border-t pt-4 text-balance text-sm font-semibold">{t("builderReview")}</h3>
          <FormField
            control={rhf.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <FormLabel>{t("activeLabel")}</FormLabel>
                  <FormDescription>{t("inactiveFormsDesc")}</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );
}

// ── Questions editor (H11) ────────────────────────────────────────────────────

function newField(index: number): TemplateField {
  return {
    key: `field_${index + 1}`,
    label: { ...EMPTY_I18N },
    kind: "text",
    required: false,
  };
}

function QuestionsCard({ form, onSaved }: { form: ApplicationForm; onSaved: () => Promise<void> }) {
  const { t, language } = useLocale();
  const [fields, setFields] = useState<TemplateField[]>(form.template);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<Language>(language);
  const [saveState, setSaveState] = useState<SaveState>("saved");

  // Re-seed if the form reloads (e.g. after a metadata save).
  useEffect(() => {
    if (saveState !== "saved") return;
    setFields(form.template);
  }, [form.template, saveState]);

  const update = (i: number, patch: Partial<TemplateField>) =>
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const updateUnsaved = (i: number, patch: Partial<TemplateField>) => {
    setSaveState("unsaved");
    update(i, patch);
  };

  const move = (i: number, dir: -1 | 1) =>
    setFields((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      setSaveState("unsaved");
      return next;
    });

  const remove = (i: number) => {
    setSaveState("unsaved");
    setFields((prev) => prev.filter((_, idx) => idx !== i));
  };

  const add = () => {
    setSaveState("unsaved");
    setFields((prev) => [...prev, newField(prev.length)]);
  };

  const setKind = (i: number, kind: FieldKind) =>
    updateUnsaved(i, {
      kind,
      // Options only exist for select/multiselect; seed one when switching in.
      options: OPTION_KINDS.includes(kind)
        ? fields[i].options?.length
          ? fields[i].options
          : [{ value: "", label: { ...EMPTY_I18N } }]
        : undefined,
    });

  function validate(): string | null {
    const seen = new Set<string>();
    for (const f of fields) {
      if (!f.key.trim()) return t("everyQuestionNeedsKey");
      if (!/^[a-zA-Z0-9_.-]+$/.test(f.key)) return t("keyMustBeAlphanumeric", { key: f.key });
      if (seen.has(f.key)) return t("duplicateKey", { key: f.key });
      seen.add(f.key);
      if (OPTION_KINDS.includes(f.kind)) {
        const opts = f.options ?? [];
        if (opts.length === 0) return t("needsAtLeastOneOption", { key: f.key });
        const optSeen = new Set<string>();
        for (const o of opts) {
          if (!o.value.trim()) return t("optionWithNoValue", { key: f.key });
          if (optSeen.has(o.value)) return t("duplicateOption", { key: f.key, value: o.value });
          optSeen.add(o.value);
        }
      }
    }
    return null;
  }

  async function save() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    setSaveState("saving");
    try {
      // PATCH /api/applications/:id { template } (APPLICATIONS_MANAGE). The
      // server re-validates with templateSchema (unique keys, option kinds).
      await api.patch<ApplicationForm>(`/api/applications/${form.id}`, {
        template: fields.map((f) => ({
          key: f.key.trim(),
          label: f.label,
          kind: f.kind,
          required: f.required,
          ...(OPTION_KINDS.includes(f.kind) ? { options: f.options } : {}),
          ...(f.kind === FILE_KIND
            ? {
                ...(f.allowed_file_types?.length
                  ? { allowed_file_types: f.allowed_file_types }
                  : {}),
                ...(f.max_file_size_mb ? { max_file_size_mb: f.max_file_size_mb } : {}),
              }
            : {}),
        })),
      });
      await onSaved();
      setSaveState("saved");
      toast.success(t("questionsSaved"));
    } catch (e) {
      setSaveState("error");
      toast.error(e instanceof ApiError ? e.message : t("couldNotSaveQuestions"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      icon={ListChecksIcon}
      title={t("questions")}
      action={
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreview(true)}
            disabled={fields.length === 0}
          >
            <EyeIcon />
            {t("preview")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PlusIcon />
            {t("addQuestion")}
          </Button>
          <FormPreviewModal
            open={preview}
            onOpenChange={setPreview}
            name={form.name}
            fields={fields}
          />
        </div>
      }
      footer={
        <>
          <SaveStatus state={saving ? "saving" : saveState} className="mr-auto" />
          <SubmitButton type="button" pending={saving} onClick={save}>
            {t("saveQuestions")}
          </SubmitButton>
        </>
      }
    >
      {fields.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title={t("noQuestionsYet")}
          description={t("noQuestionsYetDesc")}
        />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
          <div className="space-y-4">
            {fields.map((field, i) => (
              <FieldEditor
                // biome-ignore lint/suspicious/noArrayIndexKey: fields are positional and reorderable
                key={i}
                field={field}
                index={i}
                count={fields.length}
                primaryLocale={language}
                existingKeys={fields.filter((_, index) => index !== i).map((item) => item.key)}
                onChange={(patch) => updateUnsaved(i, patch)}
                onKind={(k) => setKind(i, k)}
                onMove={(dir) => move(i, dir)}
                onRemove={() => remove(i)}
              />
            ))}
          </div>
          <div className="hidden space-y-3 xl:sticky xl:top-4 xl:block">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="preview-locale">{t("previewLocale")}</Label>
              <Select
                value={previewLocale}
                onValueChange={(value) => setPreviewLocale(value as Language)}
              >
                <SelectTrigger id="preview-locale" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((locale) => (
                    <SelectItem key={locale} value={locale}>
                      {locale.toUpperCase()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FormPreviewPanel fields={fields} locale={previewLocale} />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

/** Read-only preview of the form as an applicant sees it (H11). */
function FormPreviewModal({
  open,
  onOpenChange,
  name,
  fields,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  name: string;
  fields: TemplateField[];
}) {
  const { t, language } = useLocale();
  const [locale, setLocale] = useState<Language>(language);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("previewTitle", { name })} size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="modal-preview-locale">{t("previewLocale")}</Label>
          <Select value={locale} onValueChange={(value) => setLocale(value as Language)}>
            <SelectTrigger id="modal-preview-locale" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOCALES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormPreviewPanel fields={fields} locale={locale} />
      </div>
    </Modal>
  );
}

function FormPreviewPanel({ fields, locale }: { fields: TemplateField[]; locale: Language }) {
  const { t } = useLocale();
  return (
    <div className="space-y-4 rounded-lg border p-4">
      {fields.map((f) => {
        const label = pickText(f.label, locale) || t("primaryApplicantLabel");
        const opts = f.options ?? [];
        return (
          <div key={f.key} className="space-y-1.5">
            <Label>
              {label}
              {f.required && <span className="text-destructive"> *</span>}
            </Label>
            {f.kind === "textarea" ? (
              <Textarea disabled rows={2} placeholder={t("applicantsAnswerPlaceholder")} />
            ) : f.kind === "checkbox" ? (
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <input type="checkbox" disabled /> {t("yesNoText")}
              </div>
            ) : f.kind === "select" || f.kind === "multiselect" ? (
              <div className="flex flex-wrap gap-1.5">
                {opts.length === 0 ? (
                  <span className="text-muted-foreground text-sm">{t("noOptionsDefined")}</span>
                ) : (
                  opts.map((o) => (
                    <span
                      key={o.value}
                      className="border-input rounded-md border px-2 py-0.5 text-sm"
                    >
                      {pickText(o.label, locale) || o.value}
                    </span>
                  ))
                )}
                {f.kind === "multiselect" && (
                  <span className="text-muted-foreground text-xs">{t("chooseAnyHint")}</span>
                )}
              </div>
            ) : (
              <Input
                disabled
                type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                placeholder={
                  f.kind === "file-url"
                    ? t("linkPlaceholder")
                    : f.kind === "file"
                      ? t("fileUploadPlaceholder")
                      : f.kind === "university"
                        ? t("universityPickerPlaceholder")
                        : t("applicantsAnswerPlaceholder")
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function fieldKindLabel(kind: FieldKind, t: Translate): string {
  const map: Record<FieldKind, string> = {
    text: t("fieldKindText"),
    textarea: t("fieldKindTextarea"),
    select: t("fieldKindSelect"),
    multiselect: t("fieldKindMultiselect"),
    checkbox: t("fieldKindCheckbox"),
    date: t("fieldKindDate"),
    number: t("fieldKindNumber"),
    "file-url": t("fieldKindFileUrl"),
    file: t("fieldKindFile"),
    university: t("fieldKindUniversity"),
  };
  return map[kind];
}

function FieldEditor({
  field,
  index,
  count,
  primaryLocale,
  existingKeys,
  onChange,
  onKind,
  onMove,
  onRemove,
}: {
  field: TemplateField;
  index: number;
  count: number;
  primaryLocale: Language;
  existingKeys: string[];
  onChange: (patch: Partial<TemplateField>) => void;
  onKind: (kind: FieldKind) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const setLabel = (loc: (typeof LOCALES)[number], val: string) => {
    const followsGeneratedKey =
      /^field_\d+$/.test(field.key) ||
      field.key === generatedFieldKey(field.label[primaryLocale], existingKeys);
    onChange({
      label: { ...field.label, [loc]: val },
      ...(loc === primaryLocale && followsGeneratedKey
        ? { key: generatedFieldKey(val, existingKeys) }
        : {}),
    });
  };

  const setOptions = (options: TemplateField["options"]) => onChange({ options });

  return (
    <div className="border-border space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs font-medium">#{index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon className="size-4" />
            <span className="sr-only">{t("moveUp")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon className="size-4" />
            <span className="sr-only">{t("moveDown")}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive size-8"
            onClick={onRemove}
          >
            <Trash2Icon className="size-4" />
            <span className="sr-only">{t("removeAction")}</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`question-${index}-${primaryLocale}`}>{t("primaryApplicantLabel")}</Label>
          <Input
            id={`question-${index}-${primaryLocale}`}
            value={field.label[primaryLocale]}
            onChange={(e) => setLabel(primaryLocale, e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("kindLabel")}</Label>
          <Select value={field.kind} onValueChange={(v) => onKind(v as FieldKind)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {fieldKindLabel(k, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("translationsAndSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`question-${index}-${loc}`}>{loc.toUpperCase()}</Label>
                <Input
                  id={`question-${index}-${loc}`}
                  value={field.label[loc]}
                  onChange={(e) => setLabel(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`field-key-${index}`}>{t("fieldKeyLabel")}</Label>
            <Input
              id={`field-key-${index}`}
              value={field.key}
              onChange={(e) => onChange({ key: e.target.value })}
              aria-describedby={`field-key-hint-${index}`}
            />
            <p id={`field-key-hint-${index}`} className="text-muted-foreground text-xs">
              {t("generatedAutomatically")}
            </p>
          </div>
        </div>
      </details>

      {OPTION_KINDS.includes(field.kind) && (
        <OptionsEditor
          options={field.options ?? []}
          primaryLocale={primaryLocale}
          onChange={setOptions}
        />
      )}

      {field.kind === FILE_KIND && (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t("fileRestrictions")}</summary>
          <div className="mt-3">
            <FileRestrictionsEditor field={field} onChange={onChange} />
          </div>
        </details>
      )}

      <div className="flex items-center gap-2">
        <Switch
          checked={field.required}
          onCheckedChange={(v) => onChange({ required: v })}
          id={`required-${index}`}
        />
        <Label htmlFor={`required-${index}`} className="text-sm">
          {t("required")}
        </Label>
      </div>
    </div>
  );
}

function OptionsEditor({
  options,
  primaryLocale,
  onChange,
}: {
  options: NonNullable<TemplateField["options"]>;
  primaryLocale: Language;
  onChange: (options: NonNullable<TemplateField["options"]>) => void;
}) {
  const { t } = useLocale();
  const update = (i: number, patch: Partial<{ value: string; label: I18nText }>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const add = () => onChange([...options, { value: "", label: { ...EMPTY_I18N } }]);
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));

  return (
    <div className="border-border space-y-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground text-xs uppercase">{t("optionsLabel")}</Label>
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          <PlusIcon className="size-3.5" />
          {t("addOption")}
        </Button>
      </div>
      {options.length === 0 && (
        <p className="text-muted-foreground text-xs">{t("addAtLeastOneOptionDesc")}</p>
      )}
      {options.map((opt, i) => {
        const updateLabel = (locale: Language, value: string) => {
          const followsGeneratedValue =
            !opt.value || opt.value === generatedFieldKey(opt.label[primaryLocale]);
          update(i, {
            label: { ...opt.label, [locale]: value },
            ...(locale === primaryLocale && followsGeneratedValue
              ? { value: generatedFieldKey(value) }
              : {}),
          });
        };
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
            key={i}
            className="space-y-3 rounded-md border p-3"
          >
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor={`option-${i}-${primaryLocale}`}>{t("optionApplicantLabel")}</Label>
                <Input
                  id={`option-${i}-${primaryLocale}`}
                  value={opt.label[primaryLocale]}
                  onChange={(e) => updateLabel(primaryLocale, e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-destructive size-9"
                onClick={() => remove(i)}
                aria-label={t("removeOption")}
              >
                <Trash2Icon className="size-4" />
              </Button>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                {t("translationsAndSettings")}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {LOCALES.filter((locale) => locale !== primaryLocale).map((locale) => (
                  <div key={locale} className="space-y-1.5">
                    <Label htmlFor={`option-${i}-${locale}`}>{locale.toUpperCase()}</Label>
                    <Input
                      id={`option-${i}-${locale}`}
                      value={opt.label[locale]}
                      onChange={(e) => updateLabel(locale, e.target.value)}
                    />
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor={`option-value-${i}`}>{t("valueLabel")}</Label>
                  <Input
                    id={`option-value-${i}`}
                    value={opt.value}
                    onChange={(e) => update(i, { value: e.target.value })}
                  />
                </div>
              </div>
            </details>
          </div>
        );
      })}
    </div>
  );
}

/** Upload restrictions for a "file" field: allowed extensions + size cap (H12). */
function FileRestrictionsEditor({
  field,
  onChange,
}: {
  field: TemplateField;
  onChange: (patch: Partial<TemplateField>) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="border-border grid gap-4 rounded-md border border-dashed p-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">
          {t("allowedFileTypesLabel")}
        </Label>
        <Input
          value={(field.allowed_file_types ?? []).join(", ")}
          onChange={(e) =>
            onChange({
              allowed_file_types: e.target.value
                .split(",")
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            })
          }
          placeholder=".pdf, .png, .jpg"
        />
        <p className="text-muted-foreground text-xs">{t("allowedFileTypesDesc")}</p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">{t("maxSizeMbLabel")}</Label>
        <Input
          type="number"
          min={1}
          value={field.max_file_size_mb ?? ""}
          onChange={(e) =>
            onChange({ max_file_size_mb: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="10"
        />
        <p className="text-muted-foreground text-xs">{t("blankMax10MbDesc")}</p>
      </div>
    </div>
  );
}

// ── Responses tab (H13/H14) ───────────────────────────────────────────────────

const ALL = "__all__";

interface DurableBatchResult {
  label: string;
  processed: number;
  skipped: Array<{ id: number; reason: string; applicant: string }>;
}

function ResponsesTab({
  id,
  template,
  workspace,
}: {
  id: number;
  template: TemplateField[] | null;
  workspace: ApplicationWorkspace;
}) {
  const { t } = useLocale();
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const [allRows, setAllRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<DurableBatchResult | null>(null);
  const [confirmBatchRevoke, setConfirmBatchRevoke] = useState(false);

  const rows = useMemo(() => rowsForWorkspace(allRows, workspace), [allRows, workspace]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { responses } = await api.get<{ responses: ResponseRow[] }>(
        `/api/applications/${id}/responses`,
        {
          query: {
            status: statusFilter === ALL ? undefined : statusFilter,
            search: search.trim() || undefined,
          },
        },
      );
      setAllRows(responses);
      setSelectedIds(new Set());
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadResponses");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [id, statusFilter, search, t]);

  // Soft, in-place refresh instead of a hard reload when a response changes
  // (submitted, reviewed, decided) elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // Debounce so server-side search/filter doesn't fire on every keystroke.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load, liveRefresh]);

  // Deep-link: `?response=<id>` (used by the profile Application tab) opens that
  // specific response's review modal directly — the same view as clicking a row
  // — instead of leaving the staff on the general responses list.
  const [pendingResponseId, setPendingResponseId] = useState<number | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("response");
    if (p && /^\d+$/.test(p)) setPendingResponseId(Number(p));
  }, []);
  useEffect(() => {
    if (pendingResponseId != null && rows.some((r) => r.id === pendingResponseId)) {
      setSelectedId(pendingResponseId);
      setPendingResponseId(null);
    }
  }, [rows, pendingResponseId]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const columns: Column<ResponseRow>[] = [
    {
      id: "applicant",
      header: t("applicantColumn"),
      sortValue: (r) => (r.name ?? r.email).toLowerCase(),
      cell: (r) => (
        <div className="space-y-0.5">
          <div className="font-medium">{r.name ?? "—"}</div>
          <div className="text-muted-foreground text-xs">{r.email}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: t("statusColumn"),
      sortValue: (r) => r.status,
      cell: (r) => (
        <StatusBadge tone={statusTone(r.status)}>{applicationStatusLabel(r.status, t)}</StatusBadge>
      ),
    },
    {
      id: "score",
      header: t("scoreColumn"),
      align: "right",
      sortValue: (r) => Number(r.avg_score ?? -1),
      cell: (r) => (
        <span className="text-sm">
          {fmtScore(r.avg_score)}
          {r.review_count > 0 && (
            <span className="text-muted-foreground text-xs"> · {r.review_count}</span>
          )}
        </span>
      ),
    },
    {
      id: "submitted",
      header: t("submittedColumn"),
      align: "right",
      sortValue: (r) => r.submitted_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm">{fmtDateTime(r.submitted_at)}</span>
      ),
    },
  ];

  if (workspace === "sent") {
    columns.push({
      id: "communicated",
      header: t("decisionDeliveryColumn"),
      align: "right",
      sortValue: (r) => r.decision_sent_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {r.decision_sent_at ? fmtDateTime(r.decision_sent_at) : t("notSentYet")}
        </span>
      ),
    });
    columns.push({
      id: "deadline",
      header: t("confirmationDeadlineColumn"),
      align: "right",
      sortValue: (r) => r.confirmation_expires_at ?? "",
      cell: (r) => (
        <span className="text-muted-foreground text-sm tabular-nums">
          {r.confirmation_expires_at ? fmtDateTime(r.confirmation_expires_at) : "—"}
        </span>
      ),
    });
  }

  async function batchAction(label: string, fn: () => Promise<unknown>) {
    setBatchBusy(true);
    try {
      const result = (await fn()) as
        | { processed?: number; sent?: number; skipped?: { id: number; reason: string }[] }
        | undefined;
      const skipped = (result?.skipped ?? []).map((item) => ({
        ...item,
        applicant:
          allRows.find((row) => row.id === item.id)?.name ??
          allRows.find((row) => row.id === item.id)?.email ??
          `#${item.id}`,
      }));
      setBatchResult({
        label,
        processed:
          result?.processed ?? result?.sent ?? Math.max(0, selectedIds.size - skipped.length),
        skipped,
      });
      await load();
      if (skipped.length === 0) toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("batchActionFailed"));
    } finally {
      setBatchBusy(false);
    }
  }

  const selectedArr = useMemo(
    () => rows.filter((r) => selectedIds.has(String(r.id))),
    [rows, selectedIds],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <label htmlFor="response-search" className="sr-only">
            {t("searchResponses")}
          </label>
          <Input
            id="response-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchByNameOrEmailPlaceholder")}
            className="h-9 pr-9"
          />
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-0.5 size-8 -translate-y-1/2"
              onClick={() => {
                setSearch("");
                document.getElementById("response-search")?.focus();
              }}
              aria-label={t("clearSearch")}
            >
              <XIcon aria-hidden="true" />
            </Button>
          )}
        </div>
        <span
          role="status"
          aria-live="polite"
          className="text-muted-foreground text-xs tabular-nums"
        >
          {t("tableResultCount", { count: rows.length })}
        </span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40 capitalize">
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
            {statusesForWorkspace(workspace).map((s) => (
              <SelectItem key={s} value={s}>
                {applicationStatusLabel(s, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canDecide && workspace === "outbox" && (
          <Button className="ml-auto" variant="outline" onClick={() => setSendOpen(true)}>
            <SendIcon />
            {t("sendDecisions")}
          </Button>
        )}
      </div>

      {canDecide && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <span className="text-sm font-medium">
            {t("selectedCount", { count: selectedIds.size })}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {/* Primary action per workspace (decide / send / resend). Everything
                else lives under "More" to keep the bar uncluttered. */}
            {workspace === "review" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batchBusy}>
                    <CheckCheckIcon />
                    {t("decide")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("decisionsApplied"), () =>
                        api.post("/api/responses/batch/decide", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "accepted",
                        }),
                      )
                    }
                  >
                    {t("accept")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("decisionsApplied"), () =>
                        api.post("/api/responses/batch/decide", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    {t("reject")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {workspace === "outbox" && (
              <Button
                size="sm"
                variant="outline"
                disabled={batchBusy}
                onClick={() =>
                  batchAction(t("decisionsSent"), () =>
                    api.post("/api/responses/batch/send-decision", {
                      response_ids: selectedArr.map((r) => r.id),
                    }),
                  )
                }
              >
                <SendIcon />
                {t("send")}
              </Button>
            )}
            {workspace === "sent" && (
              <Button
                size="sm"
                variant="outline"
                disabled={batchBusy}
                onClick={() =>
                  batchAction(t("decisionsResent"), () =>
                    api.post("/api/responses/batch/resend-decision", {
                      response_ids: selectedArr.map((r) => r.id),
                    }),
                  )
                }
              >
                <SendIcon />
                {t("resend")}
              </Button>
            )}
            {workspace === "outbox" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batchBusy}>
                    <RotateCcwIcon />
                    {t("more")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("revert")}</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToAcceptedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "accepted",
                        }),
                      )
                    }
                  >
                    {t("toAcceptedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToRejectedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    {t("toRejectedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("movedBackToReview"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "review",
                        }),
                      )
                    }
                  >
                    {t("backToReview")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {workspace === "sent" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={batchBusy}>
                    <RotateCcwIcon />
                    {t("more")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t("revert")}</DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToAcceptedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "accepted",
                        }),
                      )
                    }
                  >
                    {t("toAcceptedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("revertedToRejectedInternal"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    {t("toRejectedUnsend")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("movedBackToReview"), () =>
                        api.post("/api/responses/batch/revert-decision", {
                          response_ids: selectedArr.map((r) => r.id),
                          decision: "review",
                        }),
                      )
                    }
                  >
                    {t("backToReview")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      batchAction(t("reaccepted"), () =>
                        api.post("/api/responses/batch/re-accept", {
                          response_ids: selectedArr.map((r) => r.id),
                        }),
                      )
                    }
                  >
                    {t("reacceptDeclinedExpired")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmBatchRevoke(true)}
                  >
                    {t("revokeSpot")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={batchBusy}
              onClick={() => setSelectedIds(new Set())}
            >
              <XIcon />
              {t("clear")}
            </Button>
          </div>
        </div>
      )}

      {batchResult && (
        <Alert variant={batchResult.skipped.length > 0 ? "destructive" : "default"}>
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>
            {t("batchResultTitle")}: {batchResult.label}
          </AlertTitle>
          <AlertDescription>
            <p>{t("batchProcessed", { count: batchResult.processed })}</p>
            {batchResult.skipped.length > 0 && (
              <div className="mt-2">
                <p className="font-medium">
                  {t("batchSkippedTitle", { count: batchResult.skipped.length })}
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {batchResult.skipped.map((item) => (
                    <li key={item.id}>
                      {item.applicant}: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              onClick={() => setBatchResult(null)}
            >
              {t("dismissResult")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <AlertModal
        open={confirmBatchRevoke}
        onOpenChange={setConfirmBatchRevoke}
        title={t("revokeSpot")}
        description={t("revokeSpotWarning")}
        cancelLabel={t("cancel")}
        confirmLabel={t("revokeSpot")}
        destructive
        pending={batchBusy}
        onConfirm={() => {
          void batchAction(t("spotsRevoked"), () =>
            api.post("/api/responses/batch/revoke-spot", {
              response_ids: selectedArr.map((r) => r.id),
            }),
          ).finally(() => setConfirmBatchRevoke(false));
        }}
      />

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        onRowClick={(r) => setSelectedId(r.id)}
        getRowLabel={(r) => r.name ?? r.email}
        selectable={canDecide}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        pageSize={15}
        empty={{
          icon: FileTextIcon,
          title: t("noResponsesTitle"),
          description:
            statusFilter === ALL && !search.trim()
              ? t("submissionsAppearHereDesc")
              : t("noResponsesMatchFilterDesc"),
        }}
        filteredEmpty={{
          active: statusFilter !== ALL || search.trim().length > 0,
          onClear: () => {
            setStatusFilter(ALL);
            setSearch("");
            document.getElementById("response-search")?.focus();
          },
        }}
      />

      {selected && (
        <ReviewModal
          response={selected}
          applicationId={id}
          template={template}
          onClose={() => setSelectedId(null)}
          onChanged={load}
          workspace={workspace}
        />
      )}

      {canDecide && (
        <SendDecisionsModal id={id} open={sendOpen} onOpenChange={setSendOpen} onSent={load} />
      )}
    </div>
  );
}

// ── Review + decision modal (H13/H14) ─────────────────────────────────────────

function renderAnswer(
  field: TemplateField,
  value: unknown,
  universities: { id: number; name: string }[],
  lang: Language,
  t: Translate,
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value) && value.length === 0) return "—";
  switch (field.kind) {
    case "checkbox":
      return value === true ? t("yesLabel") : t("noLabel");
    case "select": {
      const opt = field.options?.find((o) => o.value === String(value));
      return opt ? pickText(opt.label, lang) : String(value);
    }
    case "multiselect": {
      const vals = Array.isArray(value) ? value : [value];
      return vals
        .map((v) => {
          const opt = field.options?.find((o) => o.value === String(v));
          return opt ? pickText(opt.label, lang) : String(v);
        })
        .join(", ");
    }
    case "university": {
      const uni = universities.find((u) => u.id === Number(value));
      return uni ? uni.name : String(value);
    }
    case "date":
      return fmtDate(value);
    default:
      return String(value);
  }
}

/** Format a stored date answer (yyyy-MM-dd, or an ISO datetime) as a plain date. */
function fmtDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  // Anchor a date-only string to UTC noon so the local-timezone render can't
  // roll it to the previous/next day.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Render a response value; file answers become a clickable link so staff (and
 *  anyone with the public URL) can open the uploaded file (H12). */
function AnswerValue({
  field,
  value,
  universities,
  lang,
}: {
  field: TemplateField;
  value: unknown;
  universities: { id: number; name: string }[];
  lang: Language;
}) {
  const { t } = useLocale();
  // A file-url is a link the applicant typed: show the URL itself so staff can
  // read and click through to it. A file is a private upload key with no
  // meaningful text, so it stays a generic "View file" link.
  if (field.kind === "file-url" && typeof value === "string" && value) {
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer"
        className="text-primary break-all underline underline-offset-4"
      >
        {value}
      </a>
    );
  }
  if (field.kind === "file" && typeof value === "string" && value) {
    return <FileLink value={value} />;
  }
  const rendered = renderAnswer(field, value, universities, lang, t);
  return <span className="whitespace-pre-wrap">{rendered}</span>;
}

export function ReviewModal({
  response,
  applicationId,
  template,
  onClose,
  onChanged,
  workspace = "review",
}: {
  response: ResponseRow;
  applicationId: number;
  template: TemplateField[] | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  workspace?: ApplicationWorkspace;
}) {
  const { t } = useLocale();
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canOverride = useCan(CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE);
  const canEdit = useCan(CAPABILITIES.APPLICATIONS_EDIT_RESPONSE);
  const me = useMe();
  const lang = (me?.language ?? "es") as Language;

  const [staffNotes, setStaffNotes] = useState(response.staff_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const [universities, setUniversities] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    api
      .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances")
      .then((res) => setIntolerances(res.intolerances))
      .catch(() => {});
    // Resolve exactly the university ids this response references (by id, not the
    // alphabetical top-50) so the name always renders instead of the raw id.
    const uniIds = new Set<string>();
    for (const f of template ?? []) {
      if (f.kind !== "university") continue;
      const v = response.responses[f.key];
      if (v != null && v !== "") uniIds.add(String(v));
    }
    if (uniIds.size === 0) return;
    api
      .get<{ universities: { id: number; name: string }[] }>("/api/public/universities", {
        query: { ids: [...uniIds].join(",") },
      })
      .then((res) => setUniversities(res.universities))
      .catch(() => {});
  }, [template, response.responses]);
  // No GET for a reviewer's own row exists — the score/notes inputs are
  // write-only (blank each open); the list column shows the average + count.
  const [myScore, setMyScore] = useState("");
  const [myNotes, setMyNotes] = useState("");
  const [reviewHydrated, setReviewHydrated] = useState(false);
  const [reviewSaveState, setReviewSaveState] = useState<SaveState>("saved");
  const [busy, setBusy] = useState(false);
  // Staff edit of the applicant's answers (APPLICATIONS_EDIT_RESPONSE). Seeded
  // from the current responses; the API replaces the whole object and re-validates
  // against the enriched template, so we send every original key back untouched.
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>(response.responses);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (!me?.id || !canReview) return;
    api
      .get<{ reviews: Array<{ author_id: number; score: number | null; notes: string | null }> }>(
        `/api/responses/${response.id}`,
      )
      .then((detail) => {
        const mine = detail.reviews.find((review) => review.author_id === me.id);
        setMyScore(mine?.score == null ? "" : String(mine.score));
        setMyNotes(mine?.notes ?? "");
        setReviewSaveState("saved");
        setReviewHydrated(true);
      })
      .catch(() => {
        setReviewSaveState("error");
        setReviewHydrated(true);
      });
  }, [response.id, me?.id, canReview]);

  useEffect(() => {
    if (!reviewHydrated || !canReview) return;
    const scoreNum = myScore.trim() ? Number(myScore) : null;
    if (scoreNum !== null && (!Number.isInteger(scoreNum) || scoreNum < 0 || scoreNum > 100)) {
      setReviewSaveState("error");
      return;
    }
    setReviewSaveState("unsaved");
    const handle = window.setTimeout(async () => {
      setReviewSaveState("saving");
      try {
        await api.put(`/api/responses/${response.id}/my-review`, {
          score: scoreNum,
          notes: myNotes.trim() || null,
        });
        setReviewSaveState("saved");
      } catch {
        setReviewSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(handle);
  }, [response.id, myScore, myNotes, reviewHydrated, canReview]);

  function startEdit() {
    setEditValues({ ...response.responses });
    setEditing(true);
  }

  async function saveEdit() {
    setSavingEdit(true);
    try {
      // PUT /api/responses/:id (APPLICATIONS_EDIT_RESPONSE) — audited server-side.
      await api.put(`/api/responses/${response.id}`, { responses: editValues });
      await onChanged();
      setEditing(false);
      toast.success(t("answersUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveAnswers"));
    } finally {
      setSavingEdit(false);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
      toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveStaffNotes() {
    setSavingNotes(true);
    try {
      // PATCH /api/responses/:id/staff-notes (APPLICATIONS_REVIEW) — shared notes.
      await api.patch(`/api/responses/${response.id}/staff-notes`, {
        staff_notes: staffNotes.trim() || null,
      });
      await onChanged();
      toast.success(t("staffNotesSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveNotes"));
    } finally {
      setSavingNotes(false);
    }
  }

  const st = response.status;
  const canScore = canReview && st !== "draft";

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      icon={FileTextIcon}
      title={response.name ?? response.email}
      description={response.email}
    >
      <div className="max-h-[65vh] space-y-6 overflow-y-auto pr-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={statusTone(st)}>{applicationStatusLabel(st, t)}</StatusBadge>
          <span className="text-muted-foreground text-xs">
            avg {fmtScore(response.avg_score)} · {response.review_count}{" "}
            {response.review_count === 1 ? t("reviewWord") : t("reviewsWord")}
          </span>
          {response.shirt_size && (
            <StatusBadge tone="neutral" dot={false}>
              {t("tshirtSize", { size: response.shirt_size })}
            </StatusBadge>
          )}
        </div>

        {(st === "accepted_internal" || st === "rejected_internal") && (
          <Alert>
            <LockIcon aria-hidden="true" />
            <AlertTitle>{applicationStatusLabel(st, t)}</AlertTitle>
            <AlertDescription>{t("internalDecisionNotice")}</AlertDescription>
          </Alert>
        )}

        {/* Answers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t("answersLabel")}</p>
            {canEdit && template && template.length > 0 && !editing && (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <PencilIcon />
                {t("editAnswers")}
              </Button>
            )}
          </div>
          {editing && template ? (
            <div className="space-y-4">
              {template.map((f) => (
                <TemplateFieldControl
                  key={f.key}
                  field={f}
                  applicationId={applicationId}
                  value={editValues[f.key] as FieldValue}
                  onChange={(v) => setEditValues((prev) => ({ ...prev, [f.key]: v }))}
                  lang={lang}
                  inDialog
                />
              ))}
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingEdit}
                  onClick={() => setEditing(false)}
                >
                  {t("cancel")}
                </Button>
                <Button size="sm" disabled={savingEdit} onClick={saveEdit}>
                  {savingEdit && <Spinner />}
                  {t("saveAnswers")}
                </Button>
              </div>
            </div>
          ) : template && template.length > 0 ? (
            <div className="divide-border divide-y">
              {template.map((f) => (
                <div key={f.key} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    {pickText(f.label, lang) || f.key}
                  </p>
                  <div className="text-sm">
                    <AnswerValue
                      field={f}
                      value={response.responses[f.key]}
                      universities={universities}
                      lang={lang}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : Object.keys(response.responses).length > 0 ? (
            <div className="divide-border divide-y">
              {Object.entries(response.responses).map(([k, v]) => (
                <div key={k} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    {k}
                  </p>
                  <div className="whitespace-pre-wrap text-sm">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noAnswersRecorded")}</p>
          )}
        </div>

        {/* Dietary info (from user row) */}
        {(response.food_intolerances?.length > 0 || response.food_intolerance_notes) && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t("dietaryInfo")}</p>
            <div className="divide-border divide-y">
              {response.food_intolerances?.length > 0 && (
                <div className="py-3 first:pt-0">
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    {t("dietaryRestrictions")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {response.food_intolerances.map((id) => {
                      const intol = intolerances.find((i) => i.id === id);
                      return intol ? (
                        <StatusBadge key={id} tone="neutral" dot={false}>
                          {pickText(intol.label, lang)}
                        </StatusBadge>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
              {response.food_intolerance_notes && (
                <div className="py-3 first:pt-0">
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase tracking-wide">
                    {t("dietaryNotes")}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{response.food_intolerance_notes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Shared staff notes (H13) */}
        {canReview && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("sharedStaffNotes")}</Label>
            <Textarea
              rows={2}
              value={staffNotes}
              onChange={(e) => setStaffNotes(e.target.value)}
              placeholder={t("visibleToAllReviewersPlaceholder")}
            />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={savingNotes} onClick={saveStaffNotes}>
                {savingNotes && <Spinner />}
                {t("saveNotes")}
              </Button>
            </div>
          </div>
        )}

        {/* This reviewer's score (H13) */}
        {canScore && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("yourReview")}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-xs">{t("reviewAutosaveHint")}</p>
              <SaveStatus state={reviewSaveState} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase">
                  {t("scoreRangeLabel")}
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={myScore}
                  onChange={(e) => setMyScore(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase">{t("notesLabel")}</Label>
                <Input value={myNotes} onChange={(e) => setMyNotes(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* Decide accept/reject — lives in the review workspace itself now, no
            separate "decisions" tab duplicating this row set (H13/H14). */}
        {workspace === "review" && (st === "review" || st === "submitted") && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("decisionLabel")}</p>
            {canDecide ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    run(t("acceptedUnsentToast"), () =>
                      api.post(`/api/responses/${response.id}/decide`, { decision: "accepted" }),
                    )
                  }
                >
                  {t("accept")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    run(t("rejectedUnsentToast"), () =>
                      api.post(`/api/responses/${response.id}/decide`, { decision: "rejected" }),
                    )
                  }
                >
                  {t("reject")}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">{t("needDecideCapability")}</p>
            )}
          </div>
        )}

        {/* Decision controls (H14) */}
        {workspace !== "review" && canDecide && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("decisionLabel")}</p>
            <div className="flex flex-wrap gap-2">
              {workspace === "outbox" &&
                (st === "accepted_internal" || st === "rejected_internal") && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(t("decisionSent"), () =>
                          api.post(`/api/responses/${response.id}/send-decision`),
                        )
                      }
                    >
                      <SendIcon />
                      {t("sendDecision")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(t("movedBackToReview"), () =>
                          api.post(`/api/responses/${response.id}/revert-decision`, {
                            decision: "review",
                          }),
                        )
                      }
                    >
                      {t("backToReview")}
                    </Button>
                  </>
                )}
              {workspace === "sent" &&
                (st === "accepted" || st === "rejected" || st === "expired") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("decisionResent"), () =>
                        api.post(`/api/responses/${response.id}/resend-decision`),
                      )
                    }
                  >
                    {t("resend")}
                  </Button>
                )}
              {workspace === "sent" && (st === "accepted" || st === "rejected") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(t("movedBackToReview"), () =>
                      api.post(`/api/responses/${response.id}/revert-decision`, {
                        decision: "review",
                      }),
                    )
                  }
                >
                  {t("backToReview")}
                </Button>
              )}
              {workspace === "sent" &&
                (st === "rejected" || st === "declined" || st === "expired") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("reacceptedUnsent"), () =>
                        api.post(`/api/responses/${response.id}/re-accept`),
                      )
                    }
                  >
                    {t("reaccept")}
                  </Button>
                )}
              {workspace === "sent" && (st === "accepted" || st === "confirmed") && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setConfirmRevoke(true)}
                >
                  {t("revokeSpot")}
                </Button>
              )}
              {workspace === "sent" && canOverride && st === "accepted" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("spotConfirmed"), () =>
                        api.post(`/api/responses/${response.id}/confirm`),
                      )
                    }
                  >
                    {t("confirmOverride")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(t("spotDeclined"), () =>
                        api.post(`/api/responses/${response.id}/decline`),
                      )
                    }
                  >
                    {t("declineOverride")}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        <AlertModal
          open={confirmRevoke}
          onOpenChange={setConfirmRevoke}
          title={t("revokeSpot")}
          description={t("revokeSpotWarning")}
          cancelLabel={t("cancel")}
          confirmLabel={t("revokeSpot")}
          destructive
          pending={busy}
          onConfirm={() => {
            void run(t("spotRevoked"), () =>
              api.post(`/api/responses/${response.id}/revoke-spot`),
            ).finally(() => setConfirmRevoke(false));
          }}
        />
      </div>
    </Modal>
  );
}

// ── Batch send decisions (H14) ────────────────────────────────────────────────

function SendDecisionsModal({
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
