"use client";

import { type MessageKey, useLocale } from "@/lib/i18n";
import type { PermissionState } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PERMISSION_STATES: PermissionState[] = ["deny", "inherit", "allow"];

export function permissionStateMessageKey(state: PermissionState): MessageKey {
  return state === "allow"
    ? "capabilityStateAllow"
    : state === "deny"
      ? "capabilityStateDeny"
      : "capabilityStateInherit";
}

/** Shared tri-state control for role capabilities and statistics panel ACLs. */
export function PermissionStateControl({
  state,
  disabled = false,
  onChange,
}: {
  state: PermissionState;
  disabled?: boolean;
  onChange: (state: PermissionState) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {PERMISSION_STATES.map((candidate, index) => (
        <button
          key={candidate}
          type="button"
          disabled={disabled}
          aria-pressed={state === candidate}
          onClick={() => onChange(candidate)}
          className={cn(
            "min-h-[var(--control-height-compact)] px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            index > 0 && "border-l",
            state === candidate
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground",
          )}
        >
          {t(permissionStateMessageKey(candidate))}
        </button>
      ))}
    </div>
  );
}
