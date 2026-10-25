"use client";

import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { createElement } from "react";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

const COPY_LINK_MESSAGES = {
  title: "toastCopyLink",
  failure: "couldNotCopyLink",
} as const satisfies { title: MessageKey; failure: MessageKey };

/**
 * Copies to the clipboard with a success/error toast (shared across invite-link
 * and QR copy actions). Callers that copy something other than a link name
 * their action in `title` and `failure` (R007).
 */
export function useCopyToClipboard(
  copy: { title: MessageKey; failure: MessageKey } = COPY_LINK_MESSAGES,
) {
  const { t } = useLocale();

  return async function copyValue(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.icon(t("copied"), {
        compactTitle: t(copy.title),
        icon: createElement(ClipboardTextIcon, { "aria-hidden": true }),
      });
    } catch {
      toast.error(t(copy.failure), t(copy.title));
    }
  };
}
