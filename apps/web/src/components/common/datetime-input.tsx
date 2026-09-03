"use client";

import { XIcon } from "lucide-react";
import { useId, useRef } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Safari (desktop and iOS) doesn't enter "type a segment" mode on Tab focus
 *  the way Chromium/Gecko do, leaving the field unusable via keyboard there
 *  (#490) — there's no feature-detection equivalent, hence the UA sniff. */
function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
}

/** On Safari, opens the native picker on keyboard focus — its arrow-key/Enter
 *  controls are keyboard-operable, unlike the raw field. Skipped on pointer
 *  focus so a click into a segment isn't interrupted by an unwanted popover.
 *  Each call gets its own pointer-tracking ref, so callers must invoke this
 *  once per input rather than sharing a single instance. */
function useOpenPickerOnKeyboardFocus(): Pick<
  React.ComponentProps<typeof Input>,
  "onPointerDown" | "onFocus"
> {
  const focusedViaPointer = useRef(false);
  return {
    onPointerDown: () => {
      focusedViaPointer.current = true;
    },
    onFocus: (e) => {
      const viaPointer = focusedViaPointer.current;
      focusedViaPointer.current = false;
      if (!viaPointer && isSafari()) {
        try {
          e.currentTarget.showPicker?.();
        } catch {
          // No transient user activation (e.g. programmatic focus) — skip silently.
        }
      }
    },
  };
}

/**
 * `<input type="date">` / `<input type="datetime-local">` with a reliable Clear
 * button. Native inputs have no consistent way to blank a once-set value
 * (Safari has none), and a blank value is how callers send `null` to the API.
 * Controlled: `value` is the date/datetime-local string, `onChange` gets ""
 * when cleared. From `sm` up a min-width keeps the native date/time text from
 * getting clipped when the input sits in a narrow flex or grid slot; on phones
 * that min-width (and the control's own intrinsic width, which is what iOS
 * Safari sizes it from) is dropped instead, since a grid/flex item that can't
 * shrink pushes the whole dialog into horizontal scroll (H59).
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
  onClear,
  id,
  min,
  max,
  step,
  size = "default",
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  type?: "date" | "datetime-local";
  nullOption?: { label: string; defaultValue?: () => string };
  disabled?: boolean;
  onClear?: () => void;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "disabled">) {
  const { t } = useLocale();
  const checkboxId = useId();
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const isBlank = value === "";
  const [datePart, timePart] = splitDateTimeLocal(value);
  const isDisabled = disabled || (nullOption ? isBlank : false);
  const dateFocusHandlers = useOpenPickerOnKeyboardFocus();
  const timeFocusHandlers = useOpenPickerOnKeyboardFocus();

  // `min`/`max` describe one combined timestamp boundary, which a lone date
  // input or lone time input can't fully express — a min of
  // "2026-08-22T10:00" doesn't mean "10:00 or later on any date". Best
  // effort: constrain the date picker to the boundary dates outright, and
  // only constrain the time picker once the boundary date is the one
  // selected (matches what a native combined widget actually enforces).
  const [minDate, minTime] = splitDateTimeLocal(typeof min === "string" ? min : "");
  const [maxDate, maxTime] = splitDateTimeLocal(typeof max === "string" ? max : "");
  const timeMin = minDate && datePart === minDate ? minTime : undefined;
  const timeMax = maxDate && datePart === maxDate ? maxTime : undefined;

  function handleDateChange(nextDate: string) {
    onChange(nextDate ? `${nextDate}T${timePart || "00:00"}` : "");
  }

  function handleTimeChange(nextTime: string) {
    if (!nextTime) {
      onChange("");
      return;
    }
    onChange(`${datePart || toDatetimeLocal(new Date().toISOString()).slice(0, 10)}T${nextTime}`);
  }

  return (
    <div className="w-full min-w-0 space-y-2">
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
      <div className="relative flex min-w-0 gap-2">
        <Input
          size={size}
          id={inputId}
          type="date"
          value={datePart}
          onChange={(e) => handleDateChange(e.target.value)}
          onBlur={(e) => {
            // Belt-and-braces: keyboard-only entry (type a segment, Tab to
            // the next field, never touching the picker) can leave the
            // native control showing a fully-typed value whose final
            // segment never fired a React onChange — re-sync from the DOM
            // on blur so a value the user can see never fails to save.
            if (e.target.value !== datePart) handleDateChange(e.target.value);
          }}
          disabled={isDisabled}
          min={minDate || undefined}
          max={maxDate || undefined}
          {...dateFocusHandlers}
          className={cn(
            "min-w-0 max-w-full sm:min-w-38",
            type === "date" && value && "pr-9",
            className,
          )}
          {...props}
        />
        {/* Two single-purpose native controls, not one combined widget: the
            browser's combined date+time popup can silently reset the time
            segment to midnight when a date is picked (seen live in
            production). Values still join/split as one "yyyy-MM-ddTHH:mm"
            string at the value/onChange boundary. */}
        {type === "datetime-local" && (
          <Input
            size={size}
            type="time"
            value={timePart}
            onChange={(e) => handleTimeChange(e.target.value)}
            onBlur={(e) => {
              if (e.target.value !== timePart) handleTimeChange(e.target.value);
            }}
            disabled={isDisabled}
            min={timeMin}
            max={timeMax}
            step={step}
            {...timeFocusHandlers}
            aria-label={t("timeLabel")}
            className={cn("min-w-0 max-w-full sm:min-w-26", value && "pr-9", className)}
          />
        )}
        {value && !disabled && (
          <IconButton
            type="button"
            variant="ghost"
            size="icon-sm"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              onClear?.();
            }}
            className="text-muted-foreground absolute top-1/2 right-1 -translate-y-1/2"
            label={t("clearDate")}
          >
            <XIcon className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/** Preserves seconds when present ("HH:mm:ss") — callers with `step` under 60s rely on them. */
function splitDateTimeLocal(value: string): [date: string, time: string] {
  if (!value) return ["", ""];
  const [date, time = ""] = value.split("T");
  return [date, time];
}
