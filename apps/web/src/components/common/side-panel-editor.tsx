"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * A focused editor that keeps its parent workspace visible on wide screens.
 * Use for a single record's settings or detail form; use Modal when the
 * decision blocks the underlying task, and a full route for deep workflows.
 */
export function SidePanelEditor({
  open,
  onOpenChange,
  onCloseAutoFocus,
  trigger,
  title,
  description,
  icon: Icon,
  footer,
  className,
  size = "default",
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCloseAutoFocus?: React.ComponentProps<typeof SheetContent>["onCloseAutoFocus"];
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  icon?: PhosphorIcon;
  footer?: React.ReactNode;
  className?: string;
  /** Compact record / paired fields / editor with a live preview. */
  size?: "default" | "wide" | "expanded";
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <div className="flex shrink-0 justify-end sm:ml-auto">
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        </div>
      )}
      <SheetContent
        side="right"
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "gap-0 p-0",
          size === "wide" && "sm:w-[min(var(--editor-width-wide),calc(100vw-1.5rem))]",
          size === "expanded" && "sm:w-[min(var(--editor-width-expanded),calc(100vw-1.5rem))]",
          className,
        )}
      >
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <SheetTitle className="type-section-title flex items-center gap-2">
            {Icon && <Icon className="size-4 text-muted-foreground" />}
            {title}
          </SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-5">{children}</div>
        {footer && (
          <SheetFooter className="shrink-0 border-t px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex-row flex-wrap items-center justify-end">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
