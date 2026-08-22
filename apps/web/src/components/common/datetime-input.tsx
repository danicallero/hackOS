"use client";

import { XIcon } from "lucide-react";
import { useId, useRef } from "react";
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
 *
 * `type="datetime-local"` renders as two native inputs — date and time —
 * instead of one. Browsers' combined date+time widget edits both segments
 * through a single popup, and picking a date there can silently reset the
 * time segment to midnight (reported live on production); splitting into
 * two single-purpose native controls means the date picker has no time to
 * touch. Values still join/split as one "yyyy-MM-ddTHH:mm" string at the
 * `value`/`onChange` boundary, so callers are unaffected.
 *
 * Safari (desktop and iOS) doesn't put a Tab-focused date/time control into
 * "type a segment" mode the way Chromium/Gecko do — without a mouse click
 * the field is unusable there (#490). There's no DOM API to select a segment
 * directly, but `showPicker()` opens the control's own native picker, whose
 * arrow-key/Enter controls are keyboard-operable, so on Safari,
 * focus-via-keyboard opens it for them. This only became safe to do once
 * date and time were split above — on the old combined datetime-local
 * input, auto-opening the picker surfaced the same time-reset bug on every
 * keyboard tab-in. Now each input's picker only ever touches that input's
 * own segment.
 *
 * Gated to Safari specifically (`isSafari()`, feature-detection has no
 * equivalent for "does this engine already enter segment-edit mode on
 * focus") — confirmed in headless Chrome that calling `showPicker()`
 * unconditionally breaks the type-a-segment-then-Tab flow that already
 * works fine there (the open picker popup swallows the following
 * keystrokes), so applying this to a browser that isn't broken would trade
 * one bug for another. Focus-via-pointer also skips this, so a mouse click
 * into a segment to type over it isn't interrupted by an unwanted popover.
 */
function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
}
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
  const dateFocusedViaPointer = useRef(false);
  const timeFocusedViaPointer = useRef(false);

  function openPickerOnKeyboardFocus(
    pointerRef: React.RefObject<boolean>,
  ): Pick<React.ComponentProps<typeof Input>, "onPointerDown" | "onFocus"> {
    return {
      onPointerDown: () => {
        pointerRef.current = true;
      },
      onFocus: (e) => {
        const viaPointer = pointerRef.current;
        pointerRef.current = false;
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
          {...openPickerOnKeyboardFocus(dateFocusedViaPointer)}
          className={cn(
            "min-w-0 max-w-full sm:min-w-[9.5rem]",
            type === "date" && value && "pr-9",
            className,
          )}
          {...props}
        />
        {type === "datetime-local" && (
          <Input
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
            {...openPickerOnKeyboardFocus(timeFocusedViaPointer)}
            aria-label={t("timeLabel")}
            className={cn("min-w-0 max-w-full sm:min-w-[6.5rem]", value && "pr-9", className)}
          />
        )}
        {value && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              onClear?.();
            }}
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

/** Preserves seconds when present ("HH:mm:ss") — callers with `step` under 60s rely on them. */
function splitDateTimeLocal(value: string): [date: string, time: string] {
  if (!value) return ["", ""];
  const [date, time = ""] = value.split("T");
  return [date, time];
}
