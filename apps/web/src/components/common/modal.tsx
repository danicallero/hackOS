"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
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
  sm: "sm:max-w-(--modal-width-sm)",
  md: "sm:max-w-(--modal-width-md)",
  lg: "sm:max-w-(--modal-width-lg)",
  xl: "sm:max-w-(--modal-width-xl)",
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
  floatingFocus = true,
  className,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  icon?: PhosphorIcon;
  size?: keyof typeof SIZES;
  footer?: React.ReactNode;
  /** Rendered in the top-right control row on desktop and in normal header
   *  flow on small screens — for controls (e.g. prev/next paging) that must
   *  stay put while the body scrolls (H13). */
  headerActions?: React.ReactNode;
  /** Visually floating content rendered in the dialog portal, outside the
   *  scrollable dialog surface (e.g. an attached file viewer). */
  floatingContent?: React.ReactNode;
  /** Allow detached content to receive focus without Radix's modal trap. */
  floatingFocus?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={!(floatingContent && floatingFocus)}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className={cn(SIZES[size], className)}
        floatingContent={floatingContent}
        floatingFocus={floatingFocus}
      >
        <DialogHeader className={cn("shrink-0 pr-10", headerActions && "sm:pr-48 text-left")}>
          <div className="min-w-0 space-y-1.5">
            <DialogTitle className="heading-row flex min-w-0 items-center gap-2">
              {Icon && <Icon className="text-muted-foreground size-5 shrink-0" />}
              <span className="heading-label min-w-0 break-words">{title}</span>
            </DialogTitle>
            {description && (
              <DialogDescription className={cn("break-words", headerActions && "text-left")}>
                {description}
              </DialogDescription>
            )}
          </div>
          {headerActions && (
            // Desktop controls share the close row; narrow screens keep them in header flow.
            <div className="flex flex-wrap items-center gap-2 pt-2 sm:absolute sm:top-3 sm:right-12 sm:max-w-[calc(100%-3.75rem)] sm:justify-end sm:gap-1 sm:pt-0">
              {headerActions}
            </div>
          )}
        </DialogHeader>
        <div className="-mx-6 min-h-0 flex-1 overscroll-contain overflow-y-auto px-6">
          {children}
        </div>
        {footer && <DialogFooter className="shrink-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
