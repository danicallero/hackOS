"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import type { I18nText, TemplateField } from "../lib";
import { generatedFieldKey } from "../workflow";
import { EMPTY_I18N, LOCALES } from "./locales";

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
