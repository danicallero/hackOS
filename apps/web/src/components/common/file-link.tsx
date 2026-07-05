"use client";

// Renders a link to an application file (H12). Application uploads are stored as
// private object keys (uploads/…); this resolves the key to a short-lived
// presigned URL via GET /api/files/download, which the API only issues to the
// file's owner or to staff. External URLs (the "file-url" field kind, or any
// http(s) value) are linked through directly.

import { FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
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
  const isDirect = /^https?:\/\//i.test(value);
  const [url, setUrl] = useState<string | null>(isDirect ? value : null);
  const [state, setState] = useState<"idle" | "loading" | "error">(isDirect ? "idle" : "loading");

  useEffect(() => {
    if (/^https?:\/\//i.test(value)) {
      setUrl(value);
      setState("idle");
      return;
    }
    let active = true;
    setState("loading");
    api
      .get<{ url: string }>("/api/files/download", { query: { key: value } })
      .then((r) => {
        if (active) {
          setUrl(r.url);
          setState("idle");
        }
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, [value]);

  if (state === "loading") {
    return <span className="text-muted-foreground text-sm">Loading file…</span>;
  }
  if (state === "error" || !url) {
    return <span className="text-muted-foreground text-sm">File unavailable</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 underline underline-offset-4", className)}
    >
      {children ?? (
        <>
          <FileTextIcon className="size-3.5" />
          View file
        </>
      )}
    </a>
  );
}
