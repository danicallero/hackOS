"use client";

import { formatPhoneAsYouType, formatPhoneInternational, normalizePhone } from "@hackos/shared/phone";
import type * as React from "react";
import { Input } from "@/components/ui/input";

type PhoneInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "onChange" | "inputMode" | "autoComplete"
> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Telephone field on the shared Input scale. Groups digits while typing and,
 * on blur, rewrites a valid number in international form (`+34 600 11 12 22`).
 * Numbers without a prefix are read as Spanish; validity is checked by the
 * form (`normalizePhone`), never by verifying the line.
 */
function PhoneInput({ value, onChange, onBlur, ...props }: PhoneInputProps) {
  return (
    <Input
      {...props}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={value}
      onChange={(e) => onChange(formatPhoneAsYouType(e.target.value))}
      onBlur={(e) => {
        const valid = normalizePhone(value);
        if (valid) onChange(formatPhoneInternational(valid));
        onBlur?.(e);
      }}
    />
  );
}

export { PhoneInput };
