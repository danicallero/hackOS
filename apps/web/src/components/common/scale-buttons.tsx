"use client";

// A row of 0-10 score buttons, plus a clear button — the judging panel's
// 0-10 scale UI (question-field.tsx), extracted so other 0-10 scorers (H13
// application review) can reuse the same interaction without pulling in
// judging's own dependency chain.

import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function ScaleButtons({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap gap-1">
      {SCALE.map((score) => (
        <Button
          key={score}
          type="button"
          size="sm"
          variant={value === score ? "default" : "outline"}
          className="size-8 p-0 text-xs font-semibold"
          disabled={disabled}
          onClick={() => onChange(score)}
        >
          {score}
        </Button>
      ))}
      {value !== null && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          {t("clear")}
        </Button>
      )}
    </div>
  );
}
