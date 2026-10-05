"use client";

import { AlertDialog } from "radix-ui";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { overlayVariants } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export function AlertModal({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  pending = false,
  destructive = false,
  onOpenChange,
  onConfirm,
  children,
  trigger,
  autoClose = false,
  reverseActions = false,
}: {
  open?: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
  destructive?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConfirm: () => void;
  children?: React.ReactNode;
  /** Optional trigger for a self-managed confirmation dialog. */
  trigger?: React.ReactNode;
  /** Close immediately after confirmation; async callers normally stay open while pending. */
  autoClose?: boolean;
  /**
   * Put the destructive action where Cancel normally sits, and vice versa,
   * for a rarer/higher-stakes confirmation (e.g. self-service account
   * deletion) where the usual "confirm is on the right" muscle memory is a
   * risk rather than a convenience.
   */
  reverseActions?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  function changeOpen(next: boolean) {
    if (!next && pending) return;
    setOpen(next);
  }

  const confirmButton = (
    <AlertDialog.Action asChild>
      <Button
        variant={destructive ? "destructive" : "default"}
        disabled={pending}
        onClick={(event) => {
          if (!autoClose || pending) event.preventDefault();
          onConfirm();
        }}
        loading={pending}
      >
        {confirmLabel}
      </Button>
    </AlertDialog.Action>
  );

  return (
    <AlertDialog.Root open={isOpen} onOpenChange={changeOpen}>
      {trigger && <AlertDialog.Trigger asChild>{trigger}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className="fixed inset-0 z-50 bg-black/50"
          onPointerDown={(event) => {
            if (event.button === 0 && event.target === event.currentTarget) changeOpen(false);
          }}
        />
        <AlertDialog.Content
          data-slot="alert-dialog-content"
          className={cn(
            overlayVariants({ elevation: "modal" }),
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto border-border/60 p-6 sm:max-w-(--modal-width-md)",
          )}
        >
          <div className="space-y-2">
            <AlertDialog.Title className="type-section-title text-balance">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-muted-foreground text-pretty text-sm">
              {description}
            </AlertDialog.Description>
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {reverseActions && confirmButton}
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            {!reverseActions && confirmButton}
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
