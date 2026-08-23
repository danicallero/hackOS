"use client";

import { MultiSelect, type MultiSelectOption } from "@/components/common/multi-select";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Shared editor for a challenge's DevPost prize tags. The caller provides the
 * imported prize keys as options; the selected values are persisted on
 * `challenges.devpost_tags` and drive queue generation.
 */
export function DevpostTagsField({
  value,
  onChange,
  options,
  disabled,
  className,
  emptyText,
}: {
  /** Selected prize tag keys. */
  value: string[];
  onChange: (value: string[]) => void;
  /** Imported prize keys the caller resolved for this challenge's event. */
  options: MultiSelectOption[];
  disabled?: boolean;
  className?: string;
  /** Overrides the default "no imported prizes" copy shown when `options` is empty. */
  emptyText?: string;
}) {
  const { t } = useLocale();
  return (
    <div className={cn("space-y-2", className)}>
      <MultiSelect
        options={options}
        value={value}
        onChange={onChange}
        placeholder={t("selectDevpostTags")}
        searchPlaceholder={t("searchImportedPrizes")}
        emptyText={emptyText ?? t("noImportedPrizes")}
        disabled={disabled}
        aria-label={t("devpostTags")}
      />
    </div>
  );
}
