"use client";

import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
} as const;

/**
 * One modal for the whole app (View Logs, confirmations, forms…). Controlled
 * via `open`/`onOpenChange`, or uncontrolled with a `trigger`. Header (icon +
 * title + description), body (children) and an optional footer are all props;
 * `size` picks the width.
 */
export function Modal({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  icon: Icon,
  size = "md",
  footer,
  headerActions,
  floatingContent,
  className,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  icon?: LucideIcon;
  size?: keyof typeof SIZES;
  footer?: React.ReactNode;
  /** Rendered in the top-right control row on desktop and in normal header
   *  flow on small screens — for controls (e.g. prev/next paging) that must
   *  stay put while the body scrolls (H13). */
  headerActions?: React.ReactNode;
  /** Visually floating content rendered in the dialog portal, outside the
   *  scrollable dialog surface (e.g. an attached file viewer). */
  floatingContent?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn(SIZES[size], className)} floatingContent={floatingContent}>
        <DialogHeader
          className={cn("relative shrink-0 pr-10", headerActions && "max-sm:pb-6 sm:pr-40")}
        >
          <div className={cn("min-w-0 space-y-1.5", headerActions && "max-sm:pr-28")}>
            <DialogTitle className="flex min-w-0 items-center gap-2">
              {Icon && <Icon className="text-muted-foreground size-5" />}
              <span className="min-w-0 break-words">{title}</span>
            </DialogTitle>
            {description && (
              <DialogDescription className={cn("break-words", headerActions && "text-left")}>
                {description}
              </DialogDescription>
            )}
          </div>
          {headerActions && (
            <div className="mt-3 flex max-w-full flex-wrap items-center justify-end gap-1 max-sm:absolute max-sm:-top-3 max-sm:right-10 max-sm:w-28 max-sm:max-w-none max-sm:mt-0 sm:absolute sm:-top-3 sm:right-10 sm:max-w-[calc(100%-2.5rem)]">
              {headerActions}
            </div>
          )}
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto px-6">{children}</div>
        {footer && <DialogFooter className="shrink-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
