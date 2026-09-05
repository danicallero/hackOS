"use client";

// A row of score buttons, plus a clear button — the judging panel's 0-10
// scale UI (question-field.tsx), extracted so other scorers can reuse the
// same interaction without pulling in judging's own dependency chain.

import { ActionGroup } from "@/components/common/action-group";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ScaleButtons({
  value,
  onChange,
  disabled,
  min = 0,
  max = 10,
  clearSize,
  className,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  clearSize?: "xs" | "sm";
  className?: string;
}) {
  const { t } = useLocale();
  const scale = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  return (
    <ActionGroup className={cn("max-w-full flex-nowrap overflow-x-auto pb-1", className)}>
      {scale.map((score) => (
        <Button
          key={score}
          type="button"
          size="icon-sm"
          variant={value === score ? "default" : "outline"}
          className="text-xs font-semibold"
          disabled={disabled}
          onClick={() => onChange(score)}
        >
          {score}
        </Button>
      ))}
      {value !== null && (
        <Button
          type="button"
          size={clearSize ?? "sm"}
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          {t("clear")}
        </Button>
      )}
    </ActionGroup>
  );
}
