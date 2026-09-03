"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type DurationInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "onChange" | "type" | "value"
> & {
  /** Total duration in whole seconds, as a string (e.g. "125"), or "" for unset. */
  value: string;
  /** Fires with the new total-seconds string whenever minutes or seconds changes. */
  onChange: (value: string) => void;
};

function splitSeconds(value: string) {
  const total = /^\d+$/.test(value) ? Number(value) : 0;

  if (total <= 0) {
    return { minutes: "", seconds: "" };
  }

  return {
    minutes: String(Math.floor(total / 60)),
    seconds: String(total % 60),
  };
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function toDurationSeconds(minutes: string, seconds: string) {
  const minuteValue = minutes === "" ? 0 : Number(minutes);
  const secondValue = seconds === "" ? 0 : Number(seconds);
  const total = minuteValue * 60 + secondValue;

  return total > 0 ? String(total) : "";
}

/** Minutes + seconds pair of native inputs backed by a single total-seconds value. */
const DurationInput = React.forwardRef<HTMLInputElement, DurationInputProps>(
  ({ value, onChange, className, disabled, id, size = "default", ...props }, ref) => {
    const { t } = useLocale();
    const {
      "aria-describedby": ariaDescribedBy,
      "aria-invalid": ariaInvalid,
      ...inputProps
    } = props;
    const initialParts = splitSeconds(value);
    const [minutes, setMinutes] = React.useState(initialParts.minutes);
    const [seconds, setSeconds] = React.useState(initialParts.seconds);
    const lastEmittedValue = React.useRef(value);

    React.useEffect(() => {
      if (value === lastEmittedValue.current) return;

      const nextParts = splitSeconds(value);
      setMinutes(nextParts.minutes);
      setSeconds(nextParts.seconds);
      lastEmittedValue.current = value;
    }, [value]);

    function emit(nextMinutes: string, nextSeconds: string) {
      const nextValue = toDurationSeconds(nextMinutes, nextSeconds);
      lastEmittedValue.current = nextValue;
      onChange(nextValue);
    }

    function updateMinutes(nextValue: string) {
      const sanitized = digitsOnly(nextValue);
      setMinutes(sanitized);
      emit(sanitized, seconds);
    }

    function updateSeconds(nextValue: string) {
      const sanitized = digitsOnly(nextValue);
      const capped = sanitized === "" ? "" : String(Math.min(Number(sanitized), 59));
      setSeconds(capped);
      emit(minutes, capped);
    }

    return (
      <div className={cn("grid gap-2 sm:grid-cols-2", className)}>
        <div className="relative">
          <Input
            {...inputProps}
            size={size}
            ref={ref}
            id={id}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            value={minutes}
            disabled={disabled}
            className="pr-12 tabular-nums"
            onChange={(event) => updateMinutes(event.target.value)}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground text-sm">
            {t("minLabel")}
          </span>
        </div>
        <div className="relative">
          <Input
            size={size}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            value={seconds}
            disabled={disabled}
            className="pr-12 tabular-nums"
            aria-label={t("presentationSecondsAria")}
            onChange={(event) => updateSeconds(event.target.value)}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground text-sm">
            {t("secLabel")}
          </span>
        </div>
      </div>
    );
  },
);
DurationInput.displayName = "DurationInput";

export { DurationInput };
