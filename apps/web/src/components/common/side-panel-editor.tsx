"use client";

import type { LucideIcon } from "lucide-react";
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
  trigger,
  title,
  description,
  icon: Icon,
  footer,
  className,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  icon?: LucideIcon;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <div className="ml-auto flex shrink-0 justify-end">
          <SheetTrigger asChild>{trigger}</SheetTrigger>
        </div>
      )}
      <SheetContent side="right" className={cn("gap-0 p-0", className)}>
        <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <SheetTitle className="type-section-title flex items-center gap-2">
            {Icon && <Icon className="size-4 text-muted-foreground" />}
            {title}
          </SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-5">{children}</div>
        {footer && (
          <SheetFooter className="shrink-0 border-t px-5 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
