"use client";

// One event-set timing: a minutes input with inline range validation and a
// "Default (N min)" reset. The draft value is `null` while the field is empty
// or out of range, which the owning tab treats as unsaveable. Shared by the
// Live Activities and Notifications categories (H45).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/lib/i18n";

export function parseTiming(raw: string, min: number, max: number): number | null {
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function TimingField({
  id,
  label,
  hint,
  value,
  defaultValue,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  /** Only for a consequence that the label does not make obvious. */
  hint?: string;
  value: number | null;
  defaultValue: number;
  min: number;
  max: number;
  onChange: (value: number | null) => void;
}) {
  const { t } = useLocale();
  const invalid = value === null;
  // The typed text is kept as typed, so an out-of-range entry stays visible
  // beside its error instead of vanishing; a value set from outside (reset,
  // reload) replaces it.
  const [text, setText] = useState(String(value ?? ""));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== null && String(value) !== text) setText(String(value));
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          className="w-24"
          value={text}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseTiming(e.target.value, min, max));
          }}
        />
        {value !== defaultValue && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(defaultValue)}>
            {t("liveActivitiesLeadReset", { minutes: defaultValue })}
          </Button>
        )}
      </div>
      {invalid ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {t("timingRangeError", { min, max })}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
