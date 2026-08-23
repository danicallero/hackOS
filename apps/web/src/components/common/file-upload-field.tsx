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
import { useLocale } from "@/lib/i18n";

export function FileUploadField({
  applicationId,
  fieldKey,
  value,
  onChange,
  allowedTypes,
  maxSizeMb,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  /** Owning application; the upload route stores the file under this id. */
  applicationId: number;
  /** Template field key the upload is attached to, used in the upload route path. */
  fieldKey: string;
  /** The stored object URL, or "" when nothing is uploaded yet. */
  value: string;
  onChange: (url: string) => void;
  /** File extensions accepted (e.g. [".pdf", ".png"]); unset allows any type. */
  allowedTypes?: string[];
  /** Max upload size in MB; defaults to 10. */
  maxSizeMb?: number;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { t } = useLocale();

  const accept = allowedTypes?.length ? allowedTypes.join(",") : undefined;
  const maxMb = maxSizeMb ?? 10;

  async function upload(file: File) {
    setUploadError(null);
    const ext = `.${(file.name.split(".").pop() ?? "").toLowerCase()}`;
    if (allowedTypes?.length && !allowedTypes.includes(ext)) {
      const message = t("fileTypeNotAllowed", { ext, allowed: allowedTypes.join(", ") });
      setUploadError(message);
      toast.error(message);
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      const message = t("fileTooLarge", { maxMb });
      setUploadError(message);
      toast.error(message);
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
      setUploadError(null);
      toast.success(t("fileUploaded"));
    } catch {
      const message = t("uploadFailed");
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const fileName = value ? decodeURIComponent(value.split("/").pop() ?? value) : null;
  const uploadErrorId = `${id ?? inputId}-upload-error`;
  const describedBy = [ariaDescribedBy, uploadError ? uploadErrorId : null]
    .filter(Boolean)
    .join(" ");
  const invalid = ariaInvalid ?? (uploadError ? true : undefined);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={id ? `${id}-input` : inputId}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled || uploading}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        aria-describedby={describedBy || undefined}
        aria-invalid={invalid}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {value ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <FileIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
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
              <XIcon aria-hidden="true" className="size-4" />
              <span className="sr-only">{t("removeFile")}</span>
            </Button>
          )}
        </div>
      ) : (
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled || uploading}
          aria-labelledby={ariaLabelledBy}
          aria-label={ariaLabel}
          aria-describedby={describedBy || undefined}
          aria-invalid={invalid}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Spinner /> : <UploadIcon aria-hidden="true" />}
          {uploading ? t("uploading") : t("chooseFile")}
        </Button>
      )}
      {uploadError && (
        <p id={uploadErrorId} role="alert" className="text-destructive text-sm">
          {uploadError}
        </p>
      )}
      <p className="text-muted-foreground flex items-center gap-1 text-xs">
        <PaperclipIcon aria-hidden="true" className="size-3" />
        {allowedTypes?.length ? allowedTypes.join(", ") : t("anyFile")} · {maxMb} MB
      </p>
    </div>
  );
}
