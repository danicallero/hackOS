"use client";

import { CalendarIcon, CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatScheduledDateTime, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function ScheduledDateTimeField({
  value,
  onChange,
  className,
  emptyLabel,
  addLabel,
  editLabel,
  clearLabel,
  inputLabel,
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
  const { t } = useLocale();
  const resolvedEmptyLabel = emptyLabel ?? t("noDateTime");
  const resolvedAddLabel = addLabel ?? t("addRevealTime");
  const resolvedEditLabel = editLabel ?? t("edit");
  const resolvedClearLabel = clearLabel ?? t("clear");
  const resolvedInputLabel = inputLabel ?? t("dateAndTime");
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!editing) return;
    setDraft(toDatetimeLocal(value));
  }, [editing, value]);

  const hasValue = Boolean(value);
  const display = hasValue ? formatScheduledDateTime(value, undefined) : resolvedEmptyLabel;
  const fieldChrome =
    "min-h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none md:text-sm dark:bg-input/50";

  function commitDraft() {
    onChange(draft);
    setEditing(false);
  }

  return (
    <div className={cn("space-y-2", className)}>
      {editing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor={inputId} className="sr-only">
            {resolvedInputLabel}
          </label>
          <Input
            id={inputId}
            type="datetime-local"
            value={draft}
            disabled={disabled}
            className="min-w-[14rem] tabular-nums"
            onChange={(e) => {
              setDraft(e.target.value);
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
              {t("confirm")}
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
              {resolvedClearLabel}
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
            {hasValue ? display : resolvedAddLabel || resolvedEmptyLabel}
          </button>
          {hasValue ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={resolvedEditLabel}
                disabled={disabled}
                onClick={() => setEditing(true)}
              >
                <PencilIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={resolvedClearLabel}
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
