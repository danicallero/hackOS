"use client";

// Read-only preview of the form as an applicant sees it (H11).

import { useState } from "react";
import { LinkifiedText } from "@/components/common/linkified-text";
import { Modal } from "@/components/common/modal";
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
import { pickText, useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import type { FormSection, TemplateField } from "../lib";
import { groupFieldsBySections, LOCALES } from "./shared";

/** Read-only preview of the form as an applicant sees it (H11). */
export function FormPreviewModal({
  open,
  onOpenChange,
  name,
  fields,
  sections,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  name: string;
  fields: TemplateField[];
  sections: FormSection[];
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
        <FormPreviewPanel fields={fields} sections={sections} locale={locale} />
      </div>
    </Modal>
  );
}

export function FormPreviewPanel({
  fields,
  sections,
  locale,
}: {
  fields: TemplateField[];
  sections: FormSection[];
  locale: Language;
}) {
  const { t } = useLocale();
  const groups = groupFieldsBySections(fields, sections);
  return (
    <div className="space-y-6">
      {groups.map((group, i) => (
        <div key={group.section?.key ?? `ungrouped-${i}`} className="space-y-3">
          {group.section && (
            <div className="space-y-0.5">
              <p className="type-section-title text-balance">
                {pickText(group.section.title, locale) || t("sections")}
              </p>
              {group.section.description && pickText(group.section.description, locale) && (
                <p className="text-muted-foreground text-pretty text-sm">
                  {pickText(group.section.description, locale)}
                </p>
              )}
            </div>
          )}
          <FieldGroupFields fields={group.fields} locale={locale} />
        </div>
      ))}
    </div>
  );
}

function FieldGroupFields({ fields, locale }: { fields: TemplateField[]; locale: Language }) {
  return (
    <div className="bg-muted/20 space-y-4 rounded-lg border p-4">
      {fields.map((f) => (
        <FieldPreviewRow key={f.key} field={f} locale={locale} />
      ))}
    </div>
  );
}

/**
 * The disabled answer control alone, matching a field's kind — no label. Used
 * both inside `FieldPreviewRow` and directly by the active `FieldEditor` for
 * kinds with nothing else to configure beyond title/type (text/date/etc — the
 * choice kinds render their editable `OptionsEditor` instead).
 */
export function AnswerPreviewControl({
  field: f,
  locale,
}: {
  field: TemplateField;
  locale: Language;
}) {
  const { t } = useLocale();
  const opts = f.options ?? [];
  const fieldId = `preview-${f.key}`;
  const customPlaceholder = f.placeholder ? pickText(f.placeholder, locale) : "";
  if (f.kind === "textarea") {
    return (
      <Textarea
        id={fieldId}
        disabled
        rows={2}
        placeholder={customPlaceholder || t("applicantsAnswerPlaceholder")}
      />
    );
  }
  if (f.kind === "checkbox") {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <input id={fieldId} type="checkbox" disabled /> {t("yesNoText")}
      </div>
    );
  }
  if (f.kind === "select" || f.kind === "multiselect") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {opts.length === 0 ? (
          <span className="text-muted-foreground text-sm">{t("noOptionsDefined")}</span>
        ) : (
          opts.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: options are positional and their value can be transiently blank/duplicate while being edited
            <span key={i} className="border-input rounded-md border px-2 py-0.5 text-sm">
              {pickText(o.label, locale) || o.value}
            </span>
          ))
        )}
        {f.kind === "multiselect" && opts.length > 0 && (
          <span className="text-muted-foreground text-xs">{t("chooseAnyHint")}</span>
        )}
      </div>
    );
  }
  return (
    <Input
      id={fieldId}
      disabled
      type={f.kind === "number" ? "number" : f.kind === "date" ? "date" : "text"}
      placeholder={
        customPlaceholder ||
        (f.kind === "file"
          ? t("fieldKindFile")
          : f.kind === "university"
            ? t("universityPickerPlaceholder")
            : t("applicantsAnswerPlaceholder"))
      }
    />
  );
}

/**
 * Read-only rendering of one field exactly as an applicant would see it:
 * label + a disabled answer control matching its kind + help text. Shared by
 * the builder's preview modal and, unfocused, by the question card itself —
 * a question shows its live preview until you click into it to edit (see
 * `FieldEditor` in questions-card.tsx).
 */
export function FieldPreviewRow({ field: f, locale }: { field: TemplateField; locale: Language }) {
  const { t } = useLocale();
  const label = pickText(f.label, locale) || t("primaryApplicantLabel");
  const fieldId = `preview-${f.key}`;
  const isChoice = f.kind === "select" || f.kind === "multiselect";
  return (
    <div className="space-y-1.5">
      {isChoice ? (
        <p className="text-sm font-medium">
          {label}
          {f.required && <span className="text-destructive"> *</span>}
        </p>
      ) : (
        <Label htmlFor={fieldId}>
          {label}
          {f.required && <span className="text-destructive"> *</span>}
        </Label>
      )}
      <AnswerPreviewControl field={f} locale={locale} />
      {f.help_text && pickText(f.help_text, locale) && (
        <p className="text-muted-foreground text-xs">
          <LinkifiedText text={pickText(f.help_text, locale)} />
        </p>
      )}
    </div>
  );
}
