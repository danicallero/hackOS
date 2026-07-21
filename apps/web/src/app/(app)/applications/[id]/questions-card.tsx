"use client";

import { EyeIcon, ListChecksIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import type { Language } from "@/lib/types";
import {
  type ApplicationForm,
  FILE_KIND,
  type FieldKind,
  OPTION_KINDS,
  type TemplateField,
} from "../lib";
import { FieldEditor } from "./field-editor";
import { FormPreviewModal, FormPreviewPanel } from "./form-preview";
import { EMPTY_I18N, LOCALES } from "./locales";

// ── Questions editor (H11) ────────────────────────────────────────────────────

function newField(index: number): TemplateField {
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
}: {
  form: ApplicationForm;
  onSaved: () => Promise<void>;
}) {
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
