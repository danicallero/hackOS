"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Title-first creation layout (docs/DESIGN.md §4b): the record title is a
 * large borderless input that acts as the page heading, optional settings are
 * collapsed `EditorRow`s, and one primary submit closes the form.
 */
export function TitleInput({
  className,
  invalid,
  errorId,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { invalid?: boolean; errorId?: string }) {
  return (
    <input
      type="text"
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      className={cn(
        "type-section-title block w-full min-w-0 rounded-sm bg-transparent py-1 text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:text-destructive aria-invalid:placeholder:text-destructive/70",
        className,
      )}
      {...props}
    />
  );
}

const POPOVER_WIDTH = {
  sm: "w-80",
  md: "w-[26rem]",
  lg: "w-[40rem]",
} as const;

/**
 * A collapsed setting: label on the left, current value on the right. It opens
 * one focused editor — a popover on desktop, a bottom sheet on narrow screens
 * (`narrow="popover"` inside a panel that is already a full-screen sheet) —
 * closed by a single Done action.
 */
export function EditorRow({
  id,
  icon: Icon,
  label,
  value,
  error,
  size = "md",
  narrow = "sheet",
  inline,
  children,
  confirm = true,
  inset = false,
}: {
  id?: string;
  icon: PhosphorIcon;
  label: string;
  /** Current value; omit when empty to show the add affordance. */
  value?: ReactNode;
  error?: string | null;
  size?: keyof typeof POPOVER_WIDTH;
  narrow?: "sheet" | "popover";
  /** A control that edits in place (for example a switch) instead of opening an editor. */
  inline?: ReactNode;
  /** A function receives `close`; pair it with `confirm={false}` for pick-one lists that close on selection. */
  children?: ReactNode | ((close: () => void) => ReactNode);
  confirm?: boolean;
  /** Horizontal padding for rows that sit edge to edge inside a surface. */
  inset?: boolean;
}) {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const errorId = useId();
  const hasValue = value !== undefined && value !== null && value !== "";

  const rowClass = cn(
    "button-interaction flex min-h-(--control-height-prominent) w-full items-center gap-3 py-2 text-left text-sm transition-colors",
    inset ? "px-4" : "rounded-sm px-1",
  );
  const left = (
    <span className="flex min-w-0 shrink-0 items-center gap-2">
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{label}</span>
    </span>
  );

  const body = (
    <div className="space-y-3">
      <div className="space-y-3">
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </div>
      {confirm && (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            {t("done")}
          </Button>
        </div>
      )}
    </div>
  );

  let editor: ReactNode = null;
  if (inline === undefined) {
    const renderRow = (onClick?: () => void) => (
      <button
        id={id}
        type="button"
        className={cn(rowClass, "group hover:bg-muted/60 aria-expanded:bg-muted/60")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...(onClick ? { onClick } : {})}
      >
        {left}
        <span
          className={cn(
            "ml-auto min-w-0 truncate text-right",
            hasValue ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {hasValue ? value : t("addRow")}
        </span>
        <CaretRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] group-aria-expanded:rotate-90 motion-reduce:transition-none"
        />
      </button>
    );
    editor =
      isMobile && narrow === "sheet" ? (
        <Sheet open={open} onOpenChange={setOpen}>
          {renderRow(() => setOpen(true))}
          <SheetContent
            side="bottom"
            className="max-h-[85dvh] gap-0 rounded-t-overlay p-0"
            aria-describedby={undefined}
          >
            <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
              <SheetTitle className="type-section-title">{label}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
              {body}
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{renderRow()}</PopoverTrigger>
          <PopoverContent
            align="end"
            className={cn(
              POPOVER_WIDTH[size],
              "max-h-(--radix-popover-content-available-height) max-w-[calc(100vw-2rem)] overflow-y-auto",
            )}
            aria-label={label}
          >
            {body}
          </PopoverContent>
        </Popover>
      );
  }

  return (
    <div className="border-b border-border/60 last:border-b-0">
      {inline !== undefined ? (
        <div className={cn(rowClass, "justify-between")}>
          {left}
          <span className="ml-auto">{inline}</span>
        </div>
      ) : (
        editor
      )}
      {error && (
        <p
          id={errorId}
          role="alert"
          className={cn("pb-2 text-sm text-destructive", inset ? "px-4" : "px-1")}
        >
          {error}
        </p>
      )}
    </div>
  );
}
