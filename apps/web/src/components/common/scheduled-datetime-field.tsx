"use client";

import { CalendarIcon, PencilIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatScheduledDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

function openNativePicker(input: HTMLInputElement | null) {
  if (!input) return;
  input.focus();
  if (typeof input.showPicker === "function") {
    input.showPicker();
    return;
  }
  input.click();
}

export function ScheduledDateTimeField({
  value,
  onChange,
  className,
  emptyLabel = "No date/time set",
  addLabel = "Add reveal time",
  editLabel = "Edit",
  clearLabel = "Clear",
  inputLabel = "Date and time",
  description,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  emptyLabel?: string;
  addLabel?: string;
  editLabel?: string;
  clearLabel?: string;
  inputLabel?: string;
  description?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) return;
    openNativePicker(inputRef.current);
  }, [editing]);

  const hasValue = Boolean(value);

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className={cn(
          "rounded-lg border p-4",
          hasValue ? "bg-muted/30" : "border-dashed bg-transparent",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1 text-sm">
            <p className={cn("font-medium", !hasValue && "text-muted-foreground")}>
              {hasValue ? formatScheduledDateTime(value) : emptyLabel}
            </p>
            {description ? (
              <p className="text-muted-foreground text-pretty">{description}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={hasValue ? "outline" : "default"}
              onClick={() => setEditing(true)}
            >
              {hasValue ? <PencilIcon className="size-4" /> : <CalendarIcon className="size-4" />}
              {hasValue ? editLabel : addLabel}
            </Button>
            {hasValue ? (
              <Button type="button" variant="ghost" onClick={() => onChange("")}>
                <XIcon className="size-4" />
                {clearLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="space-y-2">
            <label htmlFor={inputId} className="text-sm font-medium">
              {inputLabel}
            </label>
            <Input
              id={inputId}
              ref={inputRef}
              type="datetime-local"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 sm:pt-7">
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Done
            </Button>
            {hasValue ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onChange("");
                  setEditing(false);
                }}
              >
                <XIcon className="size-4" />
                {clearLabel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
