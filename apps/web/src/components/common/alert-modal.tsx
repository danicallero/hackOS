"use client";

import { AlertDialog } from "radix-ui";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
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
}: {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  pending?: boolean;
  destructive?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg",
          )}
        >
          <div className="space-y-2">
            <AlertDialog.Title className="text-balance text-lg font-semibold">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-muted-foreground text-pretty text-sm">
              {description}
            </AlertDialog.Description>
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={pending}>
                {cancelLabel}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant={destructive ? "destructive" : "default"}
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {pending && <Spinner className="size-4" />}
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
