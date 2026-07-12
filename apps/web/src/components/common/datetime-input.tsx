"use client";

import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * `<input type="datetime-local">` with a reliable Clear button. Native inputs
 * have no consistent way to blank a once-set value (Safari has none), and a
 * blank value is how callers send `null` to the API. Controlled: `value` is the
 * datetime-local string ("YYYY-MM-DDTHH:mm"), `onChange` gets "" when cleared.
 */
export function DateTimeInput({
  value,
  onChange,
  className,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type">) {
  const { t } = useLocale();
  return (
    <div className="relative">
      <Input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(value && "pr-9", className)}
        {...props}
      />
      {value && (
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
  );
}
