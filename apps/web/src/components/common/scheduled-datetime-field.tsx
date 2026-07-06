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
  disabled,
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
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    openNativePicker(inputRef.current);
  }, [editing, value]);

  const hasValue = Boolean(value);
  const display = hasValue ? formatScheduledDateTime(value) : emptyLabel;

  return (
    <div className={cn("space-y-2", className)}>
      {editing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor={inputId} className="sr-only">
            {inputLabel}
          </label>
          <Input
            id={inputId}
            ref={inputRef}
            type="datetime-local"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                onChange(draft);
                setEditing(false);
              }}
            >
              Done
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                onChange("");
                setDraft("");
                setEditing(false);
              }}
            >
              <XIcon className="size-4" />
              {clearLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className={cn(
              "min-h-10 text-left text-sm font-medium underline-offset-4 transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !hasValue && "text-muted-foreground",
              disabled && "pointer-events-none opacity-50",
            )}
            disabled={disabled}
            onClick={() => setEditing(true)}
          >
            {hasValue ? display : addLabel || emptyLabel}
          </button>
          {hasValue ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={editLabel}
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                <PencilIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={clearLabel}
                disabled={disabled}
                onClick={() => onChange("")}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          ) : (
            <CalendarIcon className="text-muted-foreground hidden size-4 sm:block" />
          )}
        </div>
      )}
      {description ? (
        <p className="text-muted-foreground text-sm text-pretty">{description}</p>
      ) : null}
    </div>
  );
}
