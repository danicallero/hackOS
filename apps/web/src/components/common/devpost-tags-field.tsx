"use client";

import { TagIcon } from "lucide-react";
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
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectOption[];
  disabled?: boolean;
  className?: string;
  emptyText?: string;
}) {
  const { t } = useLocale();
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5">
        <TagIcon className="text-muted-foreground size-4" />
        <span className="text-sm font-medium">{t("devpostTags")}</span>
      </div>
      <MultiSelect
        options={options}
        value={value}
        onChange={onChange}
        placeholder={t("selectDevpostTags")}
        searchPlaceholder={t("searchImportedPrizes")}
        emptyText={emptyText ?? t("noImportedPrizes")}
        disabled={disabled}
      />
    </div>
  );
}
