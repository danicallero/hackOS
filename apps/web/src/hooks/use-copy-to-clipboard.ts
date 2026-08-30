"use client";

import { toast } from "sonner";
import { useLocale } from "@/lib/i18n";

/** Copies to the clipboard with a success/error toast (shared across invite-link and QR copy actions). */
export function useCopyToClipboard() {
  const { t } = useLocale();

  return async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copied"));
    } catch {
      toast.error(t("couldNotCopyLink"));
    }
  };
}
