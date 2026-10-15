"use client";

// H16: a project "images" answer is an ordered list of uploaded photo keys,
// shown as a horizontal strip. The server sniffs every upload and accepts
// photos only (apps/api/src/modules/projects/files.ts).

import { MAX_IMAGES_PER_FIELD } from "@hackos/shared/forms";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useRef, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Button } from "@/components/ui/button";
import { apiUpload } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

export interface ProjectImageFile {
  objectKey: string;
  url: string;
  thumbnailUrl?: string | null;
  fileName: string;
}

export function ProjectImagesField({
  uploadPath,
  value,
  files,
  onChange,
  disabled,
  maxSizeMb = 5,
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
}: {
  uploadPath?: string;
  value: string[];
  files: ProjectImageFile[];
  onChange: (keys: string[]) => void;
  disabled?: boolean;
  maxSizeMb?: number;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const { t } = useLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploaded, setUploaded] = useState<ProjectImageFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = [...files, ...uploaded];
  const photos = value.flatMap((key) => known.find((file) => file.objectKey === key) ?? []);

  async function upload(list: FileList) {
    if (!uploadPath) return;
    setError(null);
    setUploading(true);
    const keys = [...value];
    try {
      for (const file of [...list].slice(0, MAX_IMAGES_PER_FIELD - keys.length)) {
        if (file.size > maxSizeMb * 1024 * 1024)
          throw new Error(t("fileTooLarge", { maxMb: maxSizeMb }));
        const body = new FormData();
        body.append("file", file);
        const result = await apiUpload<ProjectImageFile>(uploadPath, body);
        setUploaded((current) => [...current, result]);
        keys.push(result.objectKey);
        onChange([...keys]);
      }
    } catch (cause) {
      setError(apiErrorText(cause, t, t("uploadFailed")));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex snap-x gap-3 overflow-x-auto pb-1">
        {photos.map((photo) => (
          <figure
            key={photo.objectKey}
            className="bg-muted relative h-36 w-48 shrink-0 snap-start overflow-hidden rounded-lg"
          >
            <a href={new URL(photo.url, API_URL).toString()} target="_blank" rel="noreferrer">
              {/* biome-ignore lint/performance/noImgElement: authenticated API image, not a Next asset */}
              <img
                src={new URL(photo.thumbnailUrl ?? photo.url, API_URL).toString()}
                alt={photo.fileName}
                className="size-full object-cover"
              />
            </a>
            {!disabled && (
              <IconButton
                type="button"
                variant="secondary"
                size="icon-sm"
                label={t("removePhoto")}
                className="absolute top-2 right-2 rounded-full"
                onClick={() => onChange(value.filter((key) => key !== photo.objectKey))}
              >
                <XIcon aria-hidden="true" className="size-4" />
              </IconButton>
            )}
          </figure>
        ))}
        {!disabled && uploadPath && value.length < MAX_IMAGES_PER_FIELD && (
          <Button
            id={id}
            type="button"
            variant="outline"
            className="h-36 w-36 shrink-0 flex-col"
            loading={uploading}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            onClick={() => inputRef.current?.click()}
          >
            <PlusIcon aria-hidden="true" />
            {t("addPhotos")}
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (event.target.files?.length) void upload(event.target.files);
        }}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
