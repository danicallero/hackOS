"use client";

// Renders a link to an application file (H12). Application uploads are private
// object keys (uploads/…): the link points at the API's proxy download route,
// which streams the bytes only after re-checking the caller's session
// (owner-or-staff) on that request — so the URL is useless to anyone not
// authorised, even if copied and shared. External URLs (the "file-url" field
// kind, or public logos) are linked through directly.

import { FileTextIcon } from "lucide-react";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function FileLink({
  value,
  className,
  children,
}: {
  /** A private object key (uploads/…) or an absolute http(s) URL. */
  value: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const { t } = useLocale();
  const isDirect = /^https?:\/\//i.test(value);
  const href = isDirect ? value : `${API_URL}/api/files/download?key=${encodeURIComponent(value)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 underline underline-offset-4", className)}
    >
      {children ?? (
        <>
          <FileTextIcon className="size-3.5" />
          {t("viewFileLabel")}
        </>
      )}
    </a>
  );
}
