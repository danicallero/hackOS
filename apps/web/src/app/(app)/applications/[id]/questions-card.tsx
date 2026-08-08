"use client";

// Question builder (H11): the field list plus the per-kind editors it opens.

import type { I18nText } from "@hackos/shared/questions";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  ListChecksIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
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
import { ApiError, api } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import type { Language } from "@/lib/types";
import {
  type ApplicationForm,
  FIELD_KINDS,
  FILE_KIND,
  type FieldKind,
  OPTION_KINDS,
  type TemplateField,
} from "../lib";
import { generatedFieldKey } from "../workflow";
import { FormPreviewModal, FormPreviewPanel } from "./form-preview";
import { EMPTY_I18N, type IntoleranceOption, LOCALES, logisticsPreviewFields } from "./shared";

export function newField(index: number): TemplateField {
  return {
    key: `field_${index + 1}`,
    label: { ...EMPTY_I18N },
    kind: "text",
    required: false,
  };
}

export function QuestionsCard({
  form,
  onSaved,
  onDirtyChange,
}: {
  form: ApplicationForm;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t, language } = useLocale();
  const [fields, setFields] = useState<TemplateField[]>(form.template);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewLocale, setPreviewLocale] = useState<Language>(language);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [intolerances, setIntolerances] = useState<IntoleranceOption[]>([]);

  // Re-seed if the form reloads (e.g. after a metadata save).
  useEffect(() => {
    if (saveState !== "saved") return;
    setFields(form.template);
  }, [form.template, saveState]);

  // The dictionary backing the dietary-restrictions preview options, so the
  // preview matches what an applicant will actually pick from (H12).
  useEffect(() => {
    api
      .get<{ intolerances: IntoleranceOption[] }>("/api/public/food-intolerances")
      .then((r) => setIntolerances(r.intolerances))
      .catch(() => setIntolerances([]));
  }, []);

  useEffect(() => {
    onDirtyChange?.(saveState !== "saved");
  }, [saveState, onDirtyChange]);

  // What the applicant actually sees: custom questions plus whatever
  // shirt-size/dietary fields Form settings' logistics toggles add at submit
  // (mirrors the server's enrichTemplate — H12). Previewing only `fields`
  // would silently hide the very fields those toggles turn on.
  const previewFields = [
    ...fields,
    ...logisticsPreviewFields(form.ask_shirt_size, form.ask_food_intolerances, intolerances),
  ];

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
            disabled={previewFields.length === 0}
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
            fields={previewFields}
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
            <FormPreviewPanel fields={previewFields} locale={previewLocale} />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export function fieldKindLabel(kind: FieldKind, t: Translate): string {
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

export function FieldEditor({
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
            <span className="sr-only">{t("remove")}</span>
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
          <Label htmlFor={`question-kind-${index}`}>{t("kindLabel")}</Label>
          <Select value={field.kind} onValueChange={(v) => onKind(v as FieldKind)}>
            <SelectTrigger id={`question-kind-${index}`} className="w-full">
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

export function OptionsEditor({
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
        <p className="text-muted-foreground text-xs font-medium uppercase">{t("optionsLabel")}</p>
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
export function FileRestrictionsEditor({
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
        <Label htmlFor="allowed-file-types" className="text-muted-foreground text-xs uppercase">
          {t("allowedFileTypesLabel")}
        </Label>
        <Input
          id="allowed-file-types"
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
        <Label htmlFor="max-file-size-mb" className="text-muted-foreground text-xs uppercase">
          {t("maxSizeMbLabel")}
        </Label>
        <Input
          id="max-file-size-mb"
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
