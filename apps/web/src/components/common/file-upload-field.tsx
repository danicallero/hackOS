"use client";

// Upload control for the "file" application field kind (H12). The template field
// carries allowed_file_types / max_file_size_mb; the server re-validates both
// (apps/api/src/modules/applications/upload.routes.ts). The shared api client is
// JSON-only, so the multipart POST is a raw credentialed fetch. On success the
// returned object URL is stored as the field's value in the response object.

import { FileIcon, PaperclipIcon, UploadIcon, XIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { FileLink } from "@/components/common/file-link";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/env";

export function FileUploadField({
  applicationId,
  fieldKey,
  value,
  onChange,
  allowedTypes,
  maxSizeMb,
  disabled,
}: {
  applicationId: number;
  fieldKey: string;
  /** The stored object URL, or "" when nothing is uploaded yet. */
  value: string;
  onChange: (url: string) => void;
  allowedTypes?: string[];
  maxSizeMb?: number;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const accept = allowedTypes?.length ? allowedTypes.join(",") : undefined;
  const maxMb = maxSizeMb ?? 10;

  async function upload(file: File) {
    const ext = `.${(file.name.split(".").pop() ?? "").toLowerCase()}`;
    if (allowedTypes?.length && !allowedTypes.includes(ext)) {
      toast.error(`File type ${ext} is not allowed. Allowed: ${allowedTypes.join(", ")}`);
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`File exceeds the ${maxMb} MB limit.`);
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(
        `${API_URL}/api/applications/${applicationId}/upload/${encodeURIComponent(fieldKey)}`,
        { method: "POST", credentials: "include", body },
      );
      const text = await res.text();
      const payload = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        throw new Error(
          (payload as { error?: { message?: string } })?.error?.message ?? "Upload failed",
        );
      }
      // Store the private object key; reads resolve to a presigned URL on demand.
      onChange((payload as { key: string }).key);
      toast.success("File uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload the file.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const fileName = value ? decodeURIComponent(value.split("/").pop() ?? value) : null;

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {value ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <FileIcon className="text-muted-foreground size-4 shrink-0" />
          <FileLink value={value} className="min-w-0 flex-1 truncate">
            <span className="truncate">{fileName}</span>
          </FileLink>
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onChange("")}
            >
              <XIcon className="size-4" />
              <span className="sr-only">Remove file</span>
            </Button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner /> : <UploadIcon />}
          {uploading ? "Uploading…" : "Choose file"}
        </Button>
      )}
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <PaperclipIcon className="size-3" />
        {allowedTypes?.length ? allowedTypes.join(", ") : "Any file"} · up to {maxMb} MB
      </p>
    </div>
  );
}
