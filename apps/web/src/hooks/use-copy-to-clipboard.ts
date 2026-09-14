"use client";

import { ClipboardCheckIcon } from "lucide-react";
import { createElement } from "react";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

/** Copies to the clipboard with a success/error toast (shared across invite-link and QR copy actions). */
export function useCopyToClipboard() {
  const { t } = useLocale();

  return async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.icon(t("copied"), {
        icon: createElement(ClipboardCheckIcon, { "aria-hidden": true }),
      });
    } catch {
      toast.error(t("couldNotCopyLink"));
    }
  };
}
