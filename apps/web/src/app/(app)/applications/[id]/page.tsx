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
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { ApiError, api } from "@/lib/api";
import { pickText } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import {
  APPLICATION_TYPES,
  type ApplicationForm,
  type ApplicationStats,
  FIELD_KIND_LABEL,
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
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this form.");
      setState("error");
    }
  }, [id, canManage]);

  useEffect(() => {
    if (Number.isFinite(id)) void loadForm();
    else setState("error");
  }, [id, loadForm]);

  useEffect(() => {
    if (!canStats || !Number.isFinite(id)) return;
    api
      .get<ApplicationStats>(`/api/applications/${id}/stats`)
      .then(setStats)
      .catch(() => setStats(null));
  }, [id, canStats]);

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
          title="Form not found"
          description={errorMsg || "This application form could not be loaded."}
        />
      </div>
    );
  }

  const defaultTab = canManage ? "form" : "responses";
  const w = form ? windowState(form) : null;

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {form ? form.name : `Application #${id}`}
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
                  <span className="text-muted-foreground text-xs">quota {form.capacity}</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {canStats && stats && <StatsStrip stats={stats} />}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="w-full max-w-md">
          {canManage && <TabsTrigger value="form">Form</TabsTrigger>}
          {canReview && <TabsTrigger value="responses">Responses</TabsTrigger>}
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
                title="Metadata unavailable"
                description="The form window is closed, so its definition isn't readable here."
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
  return (
    <Link
      href="/applications"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      Back to applications
    </Link>
  );
}

// ── Stats strip (H27, logistics:stats) ────────────────────────────────────────

function StatsStrip({ stats }: { stats: ApplicationStats }) {
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
      <StatCard label="Responses" value={String(nonDraft)} icon={UsersIcon} hint="Non-draft" />
      <StatCard
        label="Accepted"
        value={String(accepted)}
        hint={`${acceptedUnsent} unsent · ${acceptedSent} sent`}
      />
      <StatCard label="Confirmed" value={String(c.confirmed ?? 0)} />
      <StatCard
        label="Declined"
        value={String(declined)}
        hint={`${declinedUnsent} unsent · ${declinedSent} sent · ${c.declined ?? 0} declined · ${c.expired ?? 0} expired`}
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
  const rhf = useForm<MetaValues>({
    resolver: zodResolver(metaSchema),
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
      rhf.setError("capacity", { message: "Must be a positive whole number" });
      return;
    }
    const windowHours = Number(values.confirmation_window_hours);
    if (!Number.isInteger(windowHours) || windowHours < 1) {
      rhf.setError("confirmation_window_hours", { message: "Must be a positive whole number" });
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
      toast.success("Form updated.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the form.");
    }
  }

  return (
    <Form {...rhf}>
      <form onSubmit={rhf.handleSubmit(onSubmit)}>
        <SectionCard
          icon={SettingsIcon}
          title="Form settings"
          description="Person type, open/close window and quota. Changes are audited."
          footer={<SubmitButton pending={rhf.formState.isSubmitting}>Save settings</SubmitButton>}
        >
          <FormField
            control={rhf.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
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
                <FormLabel>Person type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full capitalize">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {APPLICATION_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="capitalize">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {SHIRT_TYPES.includes(field.value) && (
                  <FormDescription>
                    Applicants of this type must supply a shirt size.
                  </FormDescription>
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
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea rows={2} placeholder="Shown to applicants (optional)…" {...field} />
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
                  <FormLabel>Opens</FormLabel>
                  <FormControl>
                    <DateTimeInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>Blank = open now.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={rhf.control}
              name="close_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Closes</FormLabel>
                  <FormControl>
                    <DateTimeInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <FormDescription>Blank = never closes.</FormDescription>
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
                  <FormLabel>Quota</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} placeholder="Unlimited" {...field} />
                  </FormControl>
                  <FormDescription>Cap on accepted spots (optional).</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={rhf.control}
              name="confirmation_window_hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm window (h)</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} {...field} />
                  </FormControl>
                  <FormDescription>Hours to confirm an accepted spot.</FormDescription>
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
                  <FormLabel>Active</FormLabel>
                  <FormDescription>Inactive forms are closed to new applicants.</FormDescription>
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
      if (!f.key.trim()) return "Every question needs a key.";
      if (!/^[a-zA-Z0-9_.-]+$/.test(f.key)) return `Key "${f.key}" must be alphanumeric/._-`;
      if (seen.has(f.key)) return `Duplicate key "${f.key}".`;
      seen.add(f.key);
      if (OPTION_KINDS.includes(f.kind)) {
        const opts = f.options ?? [];
        if (opts.length === 0) return `"${f.key}" needs at least one option.`;
        const optSeen = new Set<string>();
        for (const o of opts) {
          if (!o.value.trim()) return `"${f.key}" has an option with no value.`;
          if (optSeen.has(o.value)) return `"${f.key}" has duplicate option "${o.value}".`;
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
      toast.success("Questions saved.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save the questions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      icon={ListChecksIcon}
      title="Questions"
      description="Fields applicants fill in, in order. Labels carry all three locales (es/en/gl)."
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
            Preview
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <PlusIcon />
            Add question
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
          Save questions
        </SubmitButton>
      }
    >
      {fields.length === 0 ? (
        <EmptyState
          icon={ListChecksIcon}
          title="No questions yet"
          description="Add fields applicants will answer. Name, email and logistics are collected separately."
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
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Preview — ${name}`} size="lg">
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          This is how applicants see the form (Spanish labels shown). Name, email and logistics are
          collected separately.
        </p>
        {fields.map((f, i) => {
          const label = pickText(f.label, "es") || f.key;
          const opts = f.options ?? [];
          return (
            <div key={`${f.key}-${i}`} className="space-y-1.5">
              <Label>
                {label}
                {f.required && <span className="text-destructive"> *</span>}
              </Label>
              {f.kind === "textarea" ? (
                <Textarea disabled rows={2} placeholder="Applicant's answer" />
              ) : f.kind === "checkbox" ? (
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled /> Yes / No
                </div>
              ) : f.kind === "select" || f.kind === "multiselect" ? (
                <div className="flex flex-wrap gap-1.5">
                  {opts.length === 0 ? (
                    <span className="text-muted-foreground text-sm">No options defined</span>
                  ) : (
                    opts.map((o, oi) => (
                      <span
                        key={`${o.value}-${oi}`}
                        className="border-input rounded-md border px-2 py-0.5 text-sm"
                      >
                        {pickText(o.label, "es") || o.value}
                      </span>
                    ))
                  )}
                  {f.kind === "multiselect" && (
                    <span className="text-muted-foreground text-xs">(choose any)</span>
                  )}
                </div>
              ) : (
                <Input
                  disabled
                  type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
                  placeholder={
                    f.kind === "file-url"
                      ? "https://… (link)"
                      : f.kind === "file"
                        ? "File upload"
                        : f.kind === "university"
                          ? "University picker"
                          : "Applicant's answer"
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
            <span className="sr-only">Move up</span>
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
            <span className="sr-only">Move down</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive size-8"
            onClick={onRemove}
          >
            <Trash2Icon className="size-4" />
            <span className="sr-only">Remove</span>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs uppercase">Key</Label>
          <Input
            value={field.key}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="motivation"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-muted-foreground text-xs uppercase">Kind</Label>
          <Select value={field.kind} onValueChange={(v) => onKind(v as FieldKind)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {FIELD_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs uppercase">Label</Label>
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
          Required
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
  const update = (i: number, patch: Partial<{ value: string; label: I18nText }>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const add = () => onChange([...options, { value: "", label: { ...EMPTY_I18N } }]);
  const remove = (i: number) => onChange(options.filter((_, idx) => idx !== i));

  return (
    <div className="border-border space-y-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground text-xs uppercase">Options</Label>
        <Button type="button" variant="ghost" size="sm" onClick={add}>
          <PlusIcon className="size-3.5" />
          Add option
        </Button>
      </div>
      {options.length === 0 && (
        <p className="text-muted-foreground text-xs">
          Add at least one option for a choice question.
        </p>
      )}
      {options.map((opt, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
          key={i}
          className="grid items-end gap-2 sm:grid-cols-[8rem_1fr_1fr_1fr_auto]"
        >
          <div className="space-y-1">
            <span className="text-muted-foreground text-[10px] uppercase">value</span>
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
            <span className="sr-only">Remove option</span>
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
  return (
    <div className="border-border grid gap-4 rounded-md border border-dashed p-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">Allowed file types</Label>
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
        <p className="text-muted-foreground text-xs">
          Comma-separated extensions. Blank = pdf/doc/images.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs uppercase">Max size (MB)</Label>
        <Input
          type="number"
          min={1}
          value={field.max_file_size_mb ?? ""}
          onChange={(e) =>
            onChange({ max_file_size_mb: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="10"
        />
        <p className="text-muted-foreground text-xs">Blank = 10 MB.</p>
      </div>
    </div>
  );
}

// ── Responses tab (H13/H14) ───────────────────────────────────────────────────

const ALL = "__all__";

function ResponsesTab({ id, template }: { id: number; template: TemplateField[] | null }) {
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
      toast.error(err instanceof ApiError ? err.message : "Could not load responses.");
    } finally {
      setLoading(false);
    }
  }, [id, statusFilter, search]);

  // Debounce so server-side search/filter doesn't fire on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => void load(), 250);
    return () => clearTimeout(handle);
  }, [load]);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  const columns: Column<ResponseRow>[] = [
    {
      id: "applicant",
      header: "Applicant",
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
      header: "Status",
      sortValue: (r) => r.status,
      cell: (r) => (
        <StatusBadge tone={statusTone(r.status)} className="capitalize">
          {r.status === "accepted_internal"
            ? "accepted (unsent)"
            : r.status === "rejected_internal"
              ? "rejected (unsent)"
              : r.status}
        </StatusBadge>
      ),
    },
    {
      id: "score",
      header: "Score",
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
      header: "Submitted",
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
      await fn();
      await load();
      toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Batch action failed.");
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
          placeholder="Search by name or email…"
          className="h-9 max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40 capitalize">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
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
            Send decisions
          </Button>
        )}
      </div>

      {canDecide && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={batchBusy}>
                  <CheckCheckIcon />
                  Decide
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    batchAction("Decisions applied.", () =>
                      api.post("/api/responses/batch/decide", {
                        response_ids: selectedArr.map((r) => r.id),
                        decision: "accepted",
                      }),
                    )
                  }
                >
                  Accept
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    batchAction("Decisions applied.", () =>
                      api.post("/api/responses/batch/decide", {
                        response_ids: selectedArr.map((r) => r.id),
                        decision: "rejected",
                      }),
                    )
                  }
                >
                  Reject
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              disabled={batchBusy}
              onClick={() =>
                batchAction("Decisions sent.", () =>
                  api.post("/api/responses/batch/send-decision", {
                    response_ids: selectedArr.map((r) => r.id),
                  }),
                )
              }
            >
              <SendIcon />
              Send
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={batchBusy}>
                  <RotateCcwIcon />
                  Revert
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    batchAction("Reverted to accepted.", () =>
                      api.post("/api/responses/batch/revert-decision", {
                        response_ids: selectedArr.map((r) => r.id),
                        decision: "accepted",
                      }),
                    )
                  }
                >
                  Revert to accepted
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    batchAction("Reverted to rejected.", () =>
                      api.post("/api/responses/batch/revert-decision", {
                        response_ids: selectedArr.map((r) => r.id),
                        decision: "rejected",
                      }),
                    )
                  }
                >
                  Revert to rejected
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
              Clear
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
        selectable={canDecide}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        pageSize={15}
        empty={{
          icon: FileTextIcon,
          title: "No responses",
          description:
            statusFilter === ALL && !search.trim()
              ? "Submissions appear here once applicants complete the form."
              : "No responses match this filter.",
        }}
      />

      {selected && (
        <ReviewModal
          response={selected}
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

function renderAnswer(field: TemplateField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value) && value.length === 0) return "—";
  switch (field.kind) {
    case "checkbox":
      return value === true ? "Yes" : "No";
    case "select": {
      const opt = field.options?.find((o) => o.value === String(value));
      return opt ? pickText(opt.label, "es") : String(value);
    }
    case "multiselect": {
      const vals = Array.isArray(value) ? value : [value];
      return vals
        .map((v) => {
          const opt = field.options?.find((o) => o.value === String(v));
          return opt ? pickText(opt.label, "es") : String(v);
        })
        .join(", ");
    }
    default:
      return String(value);
  }
}

function ReviewModal({
  response,
  template,
  onClose,
  onChanged,
}: {
  response: ResponseRow;
  template: TemplateField[] | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const canReview = useCan(CAPABILITIES.APPLICATIONS_REVIEW);
  const canDecide = useCan(CAPABILITIES.APPLICATIONS_DECIDE);
  const canOverride = useCan(CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE);

  const [staffNotes, setStaffNotes] = useState(response.staff_notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  // No GET for a reviewer's own row exists — the score/notes inputs are
  // write-only (blank each open); the list column shows the average + count.
  const [myScore, setMyScore] = useState("");
  const [myNotes, setMyNotes] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await onChanged();
      toast.success(label);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action failed.");
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
      toast.success("Staff notes saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save notes.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function saveMyReview() {
    const scoreNum = myScore.trim() ? Number(myScore) : null;
    if (scoreNum !== null && (!Number.isInteger(scoreNum) || scoreNum < 0 || scoreNum > 100)) {
      toast.error("Score must be a whole number between 0 and 100.");
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
      toast.success("Your review was saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save your review.");
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
              ? "accepted (unsent)"
              : st === "rejected_internal"
                ? "rejected (unsent)"
                : st}
          </StatusBadge>
          <span className="text-muted-foreground text-xs">
            avg {fmtScore(response.avg_score)} · {response.review_count}{" "}
            {response.review_count === 1 ? "review" : "reviews"}
          </span>
        </div>

        {/* Answers */}
        <div className="space-y-3">
          <p className="text-sm font-medium">Answers</p>
          {template && template.length > 0 ? (
            <dl className="space-y-3">
              {template.map((f) => (
                <div key={f.key} className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
                  <dt className="text-muted-foreground text-sm">
                    {pickText(f.label, "es") || f.key}
                  </dt>
                  <dd className="text-sm">{renderAnswer(f, response.responses[f.key])}</dd>
                </div>
              ))}
            </dl>
          ) : Object.keys(response.responses).length > 0 ? (
            <dl className="space-y-3">
              {Object.entries(response.responses).map(([k, v]) => (
                <div key={k} className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
                  <dt className="text-muted-foreground font-mono text-xs">{k}</dt>
                  <dd className="text-sm">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">No answers recorded.</p>
          )}
        </div>

        {/* Shared staff notes (H13) */}
        {canReview && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Shared staff notes</Label>
            <Textarea
              rows={2}
              value={staffNotes}
              onChange={(e) => setStaffNotes(e.target.value)}
              placeholder="Visible to all reviewers…"
            />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={savingNotes} onClick={saveStaffNotes}>
                {savingNotes && <Spinner />}
                Save notes
              </Button>
            </div>
          </div>
        )}

        {/* This reviewer's score (H13) */}
        {canScore && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Your review</p>
            <p className="text-muted-foreground text-xs">
              Write-only: the API has no per-reviewer read, so this starts blank and overwrites your
              previous score on save.
            </p>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase">Score (0–100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={myScore}
                  onChange={(e) => setMyScore(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-xs uppercase">Notes</Label>
                <Input value={myNotes} onChange={(e) => setMyNotes(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={savingReview} onClick={saveMyReview}>
                {savingReview && <Spinner />}
                Save my review
              </Button>
            </div>
          </div>
        )}

        {/* Decision controls (H14) */}
        {(canReview || canDecide) && (
          <div className="border-border space-y-3 rounded-lg border p-4">
            <p className="text-sm font-medium">Decision</p>
            <div className="flex flex-wrap gap-2">
              {canDecide && st === "review" && (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run("Accepted (unsent).", () =>
                        api.post(`/api/responses/${response.id}/decide`, { decision: "accepted" }),
                      )
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() =>
                      run("Rejected (unsent).", () =>
                        api.post(`/api/responses/${response.id}/decide`, { decision: "rejected" }),
                      )
                    }
                  >
                    Reject
                  </Button>
                </>
              )}
              {canDecide && st === "accepted_internal" && (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run("Decision sent.", () =>
                        api.post(`/api/responses/${response.id}/send-decision`),
                      )
                    }
                  >
                    <SendIcon />
                    Send decision
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run("Reverted to rejected.", () =>
                        api.post(`/api/responses/${response.id}/revert-decision`, {
                          decision: "rejected",
                        }),
                      )
                    }
                  >
                    Revert to rejected
                  </Button>
                </>
              )}
              {canDecide && st === "rejected_internal" && (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run("Decision sent.", () =>
                        api.post(`/api/responses/${response.id}/send-decision`),
                      )
                    }
                  >
                    <SendIcon />
                    Send decision
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run("Reverted to accepted.", () =>
                        api.post(`/api/responses/${response.id}/revert-decision`, {
                          decision: "accepted",
                        }),
                      )
                    }
                  >
                    Revert to accepted
                  </Button>
                </>
              )}
              {canDecide && ((st === "accepted" && sent) || st === "expired") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run("Decision resent.", () =>
                      api.post(`/api/responses/${response.id}/resend-decision`),
                    )
                  }
                >
                  Resend
                </Button>
              )}
              {canDecide && (st === "rejected" || st === "declined" || st === "expired") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run("Re-accepted (unsent).", () =>
                      api.post(`/api/responses/${response.id}/re-accept`),
                    )
                  }
                >
                  Re-accept
                </Button>
              )}
              {canOverride && st === "accepted" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run("Spot confirmed.", () =>
                        api.post(`/api/responses/${response.id}/confirm`),
                      )
                    }
                  >
                    Confirm (override)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run("Spot declined.", () => api.post(`/api/responses/${response.id}/decline`))
                    }
                  >
                    Decline (override)
                  </Button>
                </>
              )}
            </div>
            {st === "review" && !canDecide && (
              <p className="text-muted-foreground text-xs">
                You need applications:decide to accept or reject.
              </p>
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
      const tokenCount = tokens.filter((t) => t.token).length;
      const msg =
        sent === 0
          ? "Nothing left to send."
          : tokenCount > 0
            ? `Sent ${sent} decision(s) (${tokenCount} with confirm links).`
            : `Sent ${sent} decision(s).`;
      toast.success(msg);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send decisions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      icon={SendIcon}
      title="Send decisions"
      description="Emails every unsent decision. Accepted applicants get a spot-confirmation link."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={send}>
            {busy && <Spinner />}
            Send now
          </Button>
        </>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="text-sm">Include rejections</Label>
          <p className="text-muted-foreground text-xs">
            Also email applicants who were rejected. Off = accepted only.
          </p>
        </div>
        <Switch checked={includeRejected} onCheckedChange={setIncludeRejected} />
      </div>
    </Modal>
  );
}
