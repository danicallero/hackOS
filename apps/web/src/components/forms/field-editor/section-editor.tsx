"use client";

// Editor for one form section (H11).

// Editor for one form section (H11).

import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { useId } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LOCALES } from "@/lib/application-form";
import { generatedFieldKey } from "@/lib/application-workflow";
import type { FormSection } from "@/lib/applications";
import { useLocale } from "@/lib/i18n";
import { EMPTY_I18N } from "@/lib/i18n-text";
import type { Language } from "@/lib/types";

/** A single section's editor: title/description (i18n), drag handle, delete.
 *  Its member fields render nested below it in `QuestionsCard`. */
export function SectionEditor({
  section,
  index,
  count,
  primaryLocale,
  existingKeys,
  dragHandle,
  onChange,
  onMove,
  onRemove,
}: {
  section: FormSection;
  index: number;
  count: number;
  primaryLocale: Language;
  existingKeys: string[];
  dragHandle?: React.ReactNode;
  onChange: (patch: Partial<FormSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  const uid = useId();
  const setTitle = (loc: (typeof LOCALES)[number], val: string) => {
    const followsGeneratedKey =
      /^section_\d+$/.test(section.key) ||
      section.key === generatedFieldKey(section.title[primaryLocale], existingKeys);
    onChange({
      title: { ...section.title, [loc]: val },
      ...(loc === primaryLocale && followsGeneratedKey
        ? { key: generatedFieldKey(val, existingKeys) }
        : {}),
    });
  };
  const setDescription = (loc: (typeof LOCALES)[number], val: string) =>
    onChange({ description: { ...(section.description ?? EMPTY_I18N), [loc]: val } });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {dragHandle}
        <Input
          aria-label={t("sectionTitleLabel")}
          placeholder={t("sectionTitleLabel")}
          value={section.title[primaryLocale]}
          onChange={(e) => setTitle(primaryLocale, e.target.value)}
          className="min-w-0 flex-1 text-lg font-semibold"
        />
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            label={t("moveUp")}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            label={t("moveDown")}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            label={t("removeSection")}
            className="text-destructive"
            onClick={onRemove}
          >
            <TrashIcon className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div className="space-y-2">
        <Input
          aria-label={t("sectionDescriptionLabel")}
          placeholder={`${t("sectionDescriptionLabel")}${t("optionalSuffix")}`}
          value={section.description?.[primaryLocale] ?? ""}
          onChange={(e) => setDescription(primaryLocale, e.target.value)}
          className="text-sm"
        />
      </div>

      <details className="border-t pt-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t("translationsAndSettings")}
        </summary>
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`section-${uid}-${loc}`}>
                  {t("sectionTitleLabel")} ({loc.toUpperCase()})
                </Label>
                <Input
                  id={`section-${uid}-${loc}`}
                  value={section.title[loc]}
                  onChange={(e) => setTitle(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LOCALES.filter((loc) => loc !== primaryLocale).map((loc) => (
              <div key={loc} className="space-y-1.5">
                <Label htmlFor={`section-desc-${uid}-${loc}`}>
                  {t("sectionDescriptionLabel")} ({loc.toUpperCase()})
                </Label>
                <Input
                  id={`section-desc-${uid}-${loc}`}
                  value={section.description?.[loc] ?? ""}
                  onChange={(e) => setDescription(loc, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`section-key-${uid}`}>{t("fieldKeyLabel")}</Label>
            <Input
              id={`section-key-${uid}`}
              value={section.key}
              onChange={(e) => onChange({ key: e.target.value })}
            />
          </div>
        </div>
      </details>
    </div>
  );
}
