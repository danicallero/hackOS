"use client";

import { AlertCircleIcon, CheckIcon, CloudUploadIcon, LoaderCircleIcon } from "lucide-react";
import { useLocale } from "@/lib/i18n";
import { type SaveState, saveStateLabel } from "@/lib/save-state";
import { cn } from "@/lib/utils";

export function SaveStatus({ state, className }: { state: SaveState; className?: string }) {
  const { t } = useLocale();
  const Icon = {
    saved: CheckIcon,
    saving: LoaderCircleIcon,
    unsaved: CloudUploadIcon,
    error: AlertCircleIcon,
  }[state];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        state === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5", state === "saving" && "animate-spin motion-reduce:animate-none")}
      />
      {saveStateLabel(state, t)}
    </span>
  );
}
