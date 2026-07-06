"use client";

import { CalendarIcon, CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatScheduledDateTime, parseScheduledDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

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
  const errorId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) return;
    setDraft(value ? formatScheduledDateTime(value) : "");
    setError("");
  }, [editing, value]);

  const hasValue = Boolean(value);
  const display = hasValue ? formatScheduledDateTime(value) : emptyLabel;
  const fieldChrome =
    "h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm dark:bg-input/50";

  function commitDraft() {
    const parsed = parseScheduledDateTime(draft);
    if (parsed === null) {
      setError("Use dd/MM/yyyy HH:mm, for example 24/02/2027 18:30.");
      return;
    }

    onChange(parsed);
    setEditing(false);
  }

  return (
    <div className={cn("space-y-2", className)}>
      {editing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor={inputId} className="sr-only">
            {inputLabel}
          </label>
          <Input
            id={inputId}
            type="text"
            inputMode="numeric"
            placeholder="dd/MM/yyyy HH:mm"
            value={draft}
            disabled={disabled}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="tabular-nums"
            onChange={(e) => {
              setDraft(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled={disabled} onClick={commitDraft}>
              <CheckIcon className="size-4" />
              OK
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
              fieldChrome,
              "text-left font-medium tabular-nums focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
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
      {error ? (
        <p id={errorId} className="text-destructive text-sm text-pretty">
          {error}
        </p>
      ) : null}
      {description ? (
        <p className="text-muted-foreground text-sm text-pretty">{description}</p>
      ) : null}
    </div>
  );
}
