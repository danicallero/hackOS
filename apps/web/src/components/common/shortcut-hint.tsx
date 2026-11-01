"use client";

import type { ComponentProps, ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ariaKeyShortcuts,
  formatShortcut,
  SHORTCUTS,
  type ShortcutId,
  useIsApplePlatform,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/**
 * The one visual form of a keyboard shortcut (#1182, docs/DESIGN.md §9): a
 * `<kbd>` chip rendered from the registry, ⌘ on Apple platforms and Ctrl
 * elsewhere. Inverts itself inside a tooltip.
 */
export function ShortcutKbd({
  shortcut,
  className,
  ...props
}: ComponentProps<"kbd"> & { shortcut: ShortcutId }) {
  const apple = useIsApplePlatform();
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm border bg-muted px-1 font-sans text-[11px] leading-none font-medium text-foreground select-none",
        "in-data-[slot=tooltip-content]:border-background/25 in-data-[slot=tooltip-content]:bg-background/15 in-data-[slot=tooltip-content]:text-background",
        className,
      )}
      {...props}
    >
      {formatShortcut(SHORTCUTS[shortcut], apple)}
    </kbd>
  );
}

/**
 * Shows a control's shortcut on hover and keyboard focus, and sets its
 * `aria-keyshortcuts` from the same registry entry. The tooltip reads
 * "label ⌘K" when the control has a label tooltip (icon-only or collapsed
 * controls), and just the chip when its visible text already names it.
 */
export function ShortcutTooltip({
  shortcut,
  label,
  side,
  hidden,
  children,
}: {
  shortcut: ShortcutId;
  label?: string;
  side?: ComponentProps<typeof TooltipContent>["side"];
  /** Keeps the shortcut announced while a visible hint replaces the tooltip. */
  hidden?: boolean;
  children: ReactElement;
}) {
  const apple = useIsApplePlatform();
  // Self-provided, as upstream shadcn's Tooltip does, so shared controls
  // (FormActions, SearchField) work in any tree.
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS[shortcut], apple)}>
          {children}
        </TooltipTrigger>
        <TooltipContent side={side} hidden={hidden} className="flex items-center gap-2">
          {label}
          <ShortcutKbd shortcut={shortcut} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
