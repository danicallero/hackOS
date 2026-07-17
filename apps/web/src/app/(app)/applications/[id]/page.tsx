"use client";

// Application form detail (H11–H14). Two tabs:
//   • Form (applications:manage) — edit metadata (window, quota, type) and a
//     questions editor (add/remove/reorder template fields with i18n labels).
//     Persists via PATCH /api/applications/:id.
//   • Responses (applications:review) — the submitted responses with review
//     controls (start-review, my-review score/notes, shared staff-notes) and,
//     for deciders (applications:decide), accept/reject + send/resend + confirm
//     /decline overrides. Optional stats strip needs logistics:stats.
//
// NOTE: the applications template uses templateFieldSchema (FIELD_KINDS), not
// the judging questionSchema. i18n labels carry {en,es,gl} (plan/07 §2).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import {
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
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EmptyState } from "@/components/common/empty-state";
import { FileLink } from "@/components/common/file-link";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { type FieldValue, TemplateFieldControl } from "@/components/common/template-field-control";
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
  RESPONSE_STATUSES,
  type ResponseRow,
  SHIRT_TYPES,
  statusTone,
  type TemplateField,
  toLocalInput,
  windowState,
} from "../lib";

const LOCALES = ["es", "en", "gl"] as const;
const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };

export default function ApplicationDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
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

  const defaultTab = canManage ? "form" : "responses";
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
        <TabsList className="w-full max-w-md">
          {canManage && <TabsTrigger value="form">{t("formTabLabel")}</TabsTrigger>}
          {canReview && <TabsTrigger value="responses">{t("responsesTabLabel")}</TabsTrigger>}
        </TabsList>

        {canManage && (
          <TabsContent value="form" className="space-y-6 pt-2">
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
          <TabsContent value="responses" className="pt-2">
            <ResponsesTab id={id} template={form?.template ?? null} />
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
      toast.success(t("formUpdated"));
    } catch (err) {
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
            <SubmitButton pending={rhf.formState.isSubmitting}>{t("saveSettings")}</SubmitButton>
          }
        >
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
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={rhf.control}
              name="open_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("colOpens")}</FormLabel>
                  <FormControl>
                    <DateTimeInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>{t("blankOpenNow")}</FormDescription>
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
                    <DateTimeInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>{t("blankNeverCloses")}</FormDescription>
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
  const { t } = useLocale();
  const [fields, setFields] = useState<TemplateField[]>(form.template);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  // Re-seed if the form reloads (e.g. after a metadata save).
  useEffect(() => {
    setFields(form.template);
  }, [form.template]);

  const update = (i: number, patch: Partial<TemplateField>) =>
    setFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const move = (i: number, dir: -1 | 1) =>
    setFields((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const remove = (i: number) => setFields((prev) => prev.filter((_, idx) => idx !== i));

  const add = () => setFields((prev) => [...prev, newField(prev.length)]);

  const setKind = (i: number, kind: FieldKind) =>
    update(i, {
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
      toast.success(t("questionsSaved"));
    } catch (e) {
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
        <SubmitButton type="button" pending={saving} onClick={save}>
          {t("saveQuestions")}
        </SubmitButton>
      }
    >
      {fields.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title={t("noQuestionsYet")}
          description={t("noQuestionsYetDesc")}
        />
      ) : (
        <div className="space-y-4">
          {fields.map((field, i) => (
            <FieldEditor
              // biome-ignore lint/suspicious/noArrayIndexKey: fields are positional and reorderable
              key={i}
              field={field}
              index={i}
              count={fields.length}
              onChange={(patch) => update(i, patch)}
              onKind={(k) => setKind(i, k)}
              onMove={(dir) => move(i, dir)}
              onRemove={() => remove(i)}
            />
          ))}
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
  const { t } = useLocale();
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("previewTitle", { name })} size="lg">
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">{t("previewIntro")}</p>
        {fields.map((f) => {
          const label = pickText(f.label, "es") || f.key;
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
                        {pickText(o.label, "es") || o.value}
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
    </Modal>
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
  onChange,
  onKind,
  onMove,
  onRemove,
}: {
  field: TemplateField;
  index: number;
  count: number;
  onChange: (patch: Partial<TemplateField>) => void;
  onKind: (kind: FieldKind) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const setLabel = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ label: { ...field.label, [loc]: val } });

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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs uppercase">{t("fieldKeyLabel")}</Label>
          <Input
            value={field.key}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="motivation"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs uppercase">{t("kindLabel")}</Label>
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

      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs uppercase">{t("fieldLabelLabel")}</Label>
        <div className="grid gap-2 sm:grid-cols-3">
          {LOCALES.map((loc) => (
            <div key={loc} className="space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase">{loc}</span>
              <Input
                value={field.label[loc]}
                onChange={(e) => setLabel(loc, e.target.value)}
                placeholder={loc}
              />
            </div>
          ))}
        </div>
      </div>

      {OPTION_KINDS.includes(field.kind) && (
        <OptionsEditor options={field.options ?? []} onChange={setOptions} />
      )}

      {field.kind === FILE_KIND && <FileRestrictionsEditor field={field} onChange={onChange} />}

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
  onChange,
}: {
  options: NonNullable<TemplateField["options"]>;
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
      {options.map((opt, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
          key={i}
          className="grid items-end gap-2 sm:grid-cols-[8rem_1fr_1fr_1fr_auto]"
        >
          <div className="space-y-1">
            <span className="text-muted-foreground text-[10px] uppercase">{t("valueLabel")}</span>
            <Input
              value={opt.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="yes"
            />
          </div>
          {LOCALES.map((loc) => (
            <div key={loc} className="space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase">{loc}</span>
              <Input
                value={opt.label[loc]}
                onChange={(e) => update(i, { label: { ...opt.label, [loc]: e.target.value } })}
                placeholder={loc}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive size-9"
            onClick={() => remove(i)}
          >
            <Trash2Icon className="size-4" />
            <span className="sr-only">{t("removeOption")}</span>
          </Button>
        </div>
      ))}
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

function ResponsesTab({ id, template }: { id: number; template: TemplateField[] | null }) {
  const { t } = useLocale();
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const [rows, setRows] = useState<ResponseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendOpen, setSendOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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
      setRows(responses);
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadResponses"));
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
        <StatusBadge tone={statusTone(r.status)} className="capitalize">
          {r.status === "accepted_internal"
            ? t("acceptedUnsentStatus")
            : r.status === "rejected_internal"
              ? t("rejectedUnsentStatus")
              : r.status}
        </StatusBadge>
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

  async function batchAction(label: string, fn: () => Promise<unknown>) {
    setBatchBusy(true);
    try {
      const result = (await fn()) as { skipped?: { id: number; reason: string }[] } | undefined;
      await load();
      // The batch endpoints now report which rows were skipped and why, so a
      // partial batch is no longer silent (previously the flaky-looking case).
      const skipped = result?.skipped ?? [];
      if (skipped.length > 0) {
        toast.warning(
          t("batchSkipped", { label, count: skipped.length, reason: skipped[0].reason }),
        );
      } else {
        toast.success(label);
      }
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
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchByNameOrEmailPlaceholder")}
          className="h-9 max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40 capitalize">
            <SelectValue placeholder={t("allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allStatuses")}</SelectItem>
            {RESPONSE_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canDecide && (
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
            {/* Primary: decide + send. Everything else lives under "More" to keep
                the bar uncluttered. */}
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
                  onClick={() =>
                    batchAction(t("spotsRevoked"), () =>
                      api.post("/api/responses/batch/revoke-spot", {
                        response_ids: selectedArr.map((r) => r.id),
                      }),
                    )
                  }
                >
                  {t("revokeSpot")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        onRowClick={(r) => setSelectedId(r.id)}
        getRowLabel={(r) => r.name ?? r.email}
        rowRole="button"
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
      />

      {selected && (
        <ReviewModal
          response={selected}
          applicationId={id}
          template={template}
          onClose={() => setSelectedId(null)}
          onChanged={load}
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
}: {
  response: ResponseRow;
  applicationId: number;
  template: TemplateField[] | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
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
  const [savingReview, setSavingReview] = useState(false);
  const [busy, setBusy] = useState(false);
  // Staff edit of the applicant's answers (APPLICATIONS_EDIT_RESPONSE). Seeded
  // from the current responses; the API replaces the whole object and re-validates
  // against the enriched template, so we send every original key back untouched.
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>(response.responses);
  const [savingEdit, setSavingEdit] = useState(false);

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

  async function saveMyReview() {
    const scoreNum = myScore.trim() ? Number(myScore) : null;
    if (scoreNum !== null && (!Number.isInteger(scoreNum) || scoreNum < 0 || scoreNum > 100)) {
      toast.error(t("scoreMustBeWhole"));
      return;
    }
    setSavingReview(true);
    try {
      // PUT /api/responses/:id/my-review (APPLICATIONS_REVIEW) — this reviewer's row.
      await api.put(`/api/responses/${response.id}/my-review`, {
        score: scoreNum,
        notes: myNotes.trim() || null,
      });
      await onChanged();
      toast.success(t("reviewSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveReview"));
    } finally {
      setSavingReview(false);
    }
  }

  const st = response.status;
  const canScore = canReview && st !== "draft";
  const sent = Boolean(response.decision_sent_at);

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
          <StatusBadge tone={statusTone(st)} className="capitalize">
            {st === "accepted_internal"
              ? t("acceptedUnsentStatus")
              : st === "rejected_internal"
                ? t("rejectedUnsentStatus")
                : st}
          </StatusBadge>
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
            <p className="text-muted-foreground text-xs">{t("reviewWriteOnlyHint")}</p>
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
            <div className="flex justify-end">
              <Button size="sm" disabled={savingReview} onClick={saveMyReview}>
                {savingReview && <Spinner />}
                {t("saveMyReview")}
              </Button>
            </div>
          </div>
        )}

        {/* Decision controls (H14) */}
        {(canReview || canDecide) && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">{t("decisionLabel")}</p>
            <div className="flex flex-wrap gap-2">
              {canDecide && st === "review" && (
                <>
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
                </>
              )}
              {canDecide && st === "accepted_internal" && (
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
              {canDecide && st === "rejected_internal" && (
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
              {canDecide && ((st === "accepted" && sent) || st === "expired") && (
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
              {canDecide && (st === "accepted" || st === "rejected") && (
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
              {canDecide && (st === "rejected" || st === "declined" || st === "expired") && (
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
              {canDecide && ((st === "accepted" && sent) || st === "confirmed") && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    run(t("spotRevoked"), () =>
                      api.post(`/api/responses/${response.id}/revoke-spot`),
                    )
                  }
                >
                  {t("revokeSpot")}
                </Button>
              )}
              {canOverride && st === "accepted" && (
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
            {st === "review" && !canDecide && (
              <p className="text-muted-foreground text-xs">{t("needDecideCapability")}</p>
            )}
          </div>
        )}
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
