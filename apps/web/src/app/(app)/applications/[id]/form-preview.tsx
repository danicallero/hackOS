"use client";

// Read-only preview of the form as an applicant sees it (H11).

import { useState } from "react";
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
import type { TemplateField } from "../lib";
import { LOCALES } from "./shared";

/** Read-only preview of the form as an applicant sees it (H11). */
export function FormPreviewModal({
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

export function FormPreviewPanel({
  fields,
  locale,
}: {
  fields: TemplateField[];
  locale: Language;
}) {
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
                      ? t("fieldKindFile")
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
