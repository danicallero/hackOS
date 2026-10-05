"use client";

import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CloudArrowUpIcon } from "@phosphor-icons/react/dist/csr/CloudArrowUp";
import { SpinnerGapIcon } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { useLocale } from "@/lib/i18n";
import { type SaveState, saveStateLabel } from "@/lib/save-state";
import { cn } from "@/lib/utils";

/** Icon + label for an autosave field's current state (saved/saving/unsaved/error). */
export function SaveStatus({
  state,
  className,
  showIcon = true,
}: {
  state: SaveState;
  className?: string;
  showIcon?: boolean;
}) {
  const { t } = useLocale();
  const Icon = {
    saved: CheckIcon,
    saving: SpinnerGapIcon,
    unsaved: CloudArrowUpIcon,
    error: WarningCircleIcon,
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
      {showIcon && (
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3.5",
            state === "saving" && "animate-spin motion-reduce:animate-none",
          )}
        />
      )}
      {saveStateLabel(state, t)}
    </span>
  );
}
