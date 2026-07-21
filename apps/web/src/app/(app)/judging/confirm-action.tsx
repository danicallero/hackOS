"use client";

// Destructive/irreversible queue actions route through one confirm dialog
// so the wording and the escape hatch are identical everywhere (H33-H35).

import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

export function ConfirmAction({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  /** Omit when driving the dialog externally via `open`/`onOpenChange` (e.g. from a dropdown item). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialogPrimitive.Content className="bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border p-6 shadow-lg sm:max-w-lg">
          <AlertDialogPrimitive.Title className="type-section-title text-balance">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-muted-foreground text-pretty text-sm">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline">{t("cancel")}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
