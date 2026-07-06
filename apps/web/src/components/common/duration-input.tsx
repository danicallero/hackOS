"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DurationInputProps = Omit<React.ComponentProps<"input">, "onChange" | "type" | "value"> & {
  value: string;
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

const DurationInput = React.forwardRef<HTMLInputElement, DurationInputProps>(
  ({ value, onChange, className, disabled, id, ...props }, ref) => {
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
            min
          </span>
        </div>
        <div className="relative">
          <Input
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            value={seconds}
            disabled={disabled}
            className="pr-12 tabular-nums"
            aria-label="Presentation seconds"
            onChange={(event) => updateSeconds(event.target.value)}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground text-sm">
            sec
          </span>
        </div>
      </div>
    );
  },
);
DurationInput.displayName = "DurationInput";

export { DurationInput };
