"use client";

import { XIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * `<input type="date">` / `<input type="datetime-local">` with a reliable Clear
 * button. Native inputs have no consistent way to blank a once-set value
 * (Safari has none), and a blank value is how callers send `null` to the API.
 * Controlled: `value` is the date/datetime-local string, `onChange` gets ""
 * when cleared. A min-width keeps the native date/time text from getting
 * clipped when the input sits in a narrow flex or grid slot.
 *
 * `nullOption` replaces a "leave blank to mean X" hint with an explicit
 * checkbox: checked means the value is null/blank (the input is disabled),
 * unchecking populates the input with `nullOption.defaultValue()` (or now)
 * so there's something concrete to edit.
 */
export function DateTimeInput({
  value,
  onChange,
  className,
  type = "datetime-local",
  nullOption,
  disabled,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: "date" | "datetime-local";
  nullOption?: { label: string; defaultValue?: () => string };
  disabled?: boolean;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "disabled">) {
  const { t } = useLocale();
  const checkboxId = useId();
  const isBlank = value === "";
  return (
    <div className="space-y-2">
      {nullOption && (
        <label
          htmlFor={checkboxId}
          className={cn(
            "text-muted-foreground flex items-center gap-2 text-sm",
            disabled && "opacity-50",
          )}
        >
          <Checkbox
            id={checkboxId}
            checked={isBlank}
            disabled={disabled}
            onCheckedChange={(checked) => {
              if (checked === true) onChange("");
              else
                onChange(nullOption.defaultValue?.() ?? toDatetimeLocal(new Date().toISOString()));
            }}
          />
          {nullOption.label}
        </label>
      )}
      <div className="relative">
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || (nullOption ? isBlank : false)}
          className={cn(
            type === "date" ? "min-w-[9.5rem]" : "min-w-[14rem]",
            value && "pr-9",
            className,
          )}
          {...props}
        />
        {value && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange("")}
            className="text-muted-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label={t("clearDate")}
          >
            <XIcon className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
