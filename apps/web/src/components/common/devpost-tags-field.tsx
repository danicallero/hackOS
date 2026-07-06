"use client";

import { TagIcon } from "lucide-react";
import { MultiSelect, type MultiSelectOption } from "@/components/common/multi-select";
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
  emptyText = "No imported prizes yet.",
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: MultiSelectOption[];
  disabled?: boolean;
  className?: string;
  emptyText?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5">
        <TagIcon className="text-muted-foreground size-4" />
        <span className="text-sm font-medium">DevPost tags</span>
      </div>
      <MultiSelect
        options={options}
        value={value}
        onChange={onChange}
        placeholder="Select DevPost tags"
        searchPlaceholder="Search imported prizes..."
        emptyText={emptyText}
        disabled={disabled}
      />
      <p className="text-muted-foreground text-xs">
        These tags determine which imported projects enter the queue for this challenge.
      </p>
    </div>
  );
}
