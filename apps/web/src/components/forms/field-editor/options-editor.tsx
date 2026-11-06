"use client";

// Editable option list for choice questions.

import type { I18nText } from "@hackos/shared/questions";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { IconButton } from "@/components/common/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOCALES } from "@/lib/application-form";
import { generatedFieldKey } from "@/lib/application-workflow";
import type { TemplateField } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";
import { EMPTY_I18N } from "@/lib/i18n-text";
import type { Language } from "@/lib/types";

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
    <div className="space-y-1">
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
          // biome-ignore lint/suspicious/noArrayIndexKey: options are positional
          <div key={i} className="group space-y-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="border-muted-foreground/50 size-4 shrink-0 rounded-full border"
              />
              <Input
                aria-label={t("optionApplicantLabel")}
                value={opt.label[primaryLocale]}
                onChange={(e) => updateLabel(primaryLocale, e.target.value)}
              />
              <IconButton
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => remove(i)}
                label={t("removeOption")}
              >
                <XIcon className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
            <details className="ml-6">
              <summary className="text-muted-foreground cursor-pointer text-xs">
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={add}
        className="text-muted-foreground"
      >
        <PlusIcon aria-hidden="true" className="size-3.5" />
        {t("addOption")}
      </Button>
    </div>
  );
}
