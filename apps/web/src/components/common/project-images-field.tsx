"use client";

// H16: a project "images" answer is an ordered list of uploaded photo keys,
// shown as a horizontal strip. The server sniffs every upload and accepts
// photos only (apps/api/src/modules/projects/files.ts).

import { MAX_IMAGES_PER_FIELD } from "@hackos/shared/forms";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ImagesIcon } from "@phosphor-icons/react/dist/csr/Images";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useRef, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
  const canAdd = !disabled && Boolean(uploadPath) && value.length < MAX_IMAGES_PER_FIELD;
  const [viewing, setViewing] = useState<number | null>(null);
  const current = viewing === null ? null : photos[viewing];
  const step = (delta: number) =>
    setViewing((index) =>
      index === null ? null : (index + delta + photos.length) % photos.length,
    );

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
      {canAdd && photos.length === 0 && (
        <Button
          id={id}
          type="button"
          variant="outline"
          loading={uploading}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          onClick={() => inputRef.current?.click()}
        >
          <ImagesIcon aria-hidden="true" />
          {t("addPhotos")}
        </Button>
      )}
      <div className={photos.length ? "flex snap-x gap-3 overflow-x-auto pb-1" : "hidden"}>
        {photos.map((photo, index) => (
          <figure
            key={photo.objectKey}
            className="bg-muted relative h-36 w-48 shrink-0 snap-start overflow-hidden rounded-lg"
          >
            <button
              type="button"
              className="focus-visible:ring-ring size-full cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none"
              aria-label={photo.fileName}
              onClick={() => setViewing(index)}
            >
              {/* biome-ignore lint/performance/noImgElement: authenticated API image, not a Next asset */}
              <img
                src={new URL(photo.thumbnailUrl ?? photo.url, API_URL).toString()}
                alt=""
                className="size-full object-cover transition-opacity hover:opacity-90"
              />
            </button>
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
        {canAdd && photos.length > 0 && (
          <button
            id={id}
            type="button"
            disabled={uploading}
            aria-labelledby={ariaLabelledBy}
            aria-describedby={ariaDescribedBy}
            aria-label={t("addPhotos")}
            title={t("addPhotos")}
            onClick={() => inputRef.current?.click()}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex h-36 w-20 shrink-0 snap-start items-center justify-center rounded-lg border border-dashed transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
          >
            {uploading ? (
              <Spinner className="size-5" />
            ) : (
              <PlusIcon aria-hidden="true" className="size-5" />
            )}
          </button>
        )}
      </div>
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent
          className="w-auto max-w-[calc(100vw-2rem)] gap-0 overflow-hidden bg-black p-0 sm:max-w-[min(1200px,calc(100vw-4rem))]"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") step(-1);
            if (event.key === "ArrowRight") step(1);
          }}
        >
          <DialogTitle className="sr-only">{current?.fileName ?? t("addPhotos")}</DialogTitle>
          {current && (
            // biome-ignore lint/performance/noImgElement: authenticated API image, not a Next asset
            <img
              src={new URL(current.url, API_URL).toString()}
              alt={current.fileName}
              className="max-h-[85dvh] w-auto max-w-full object-contain"
            />
          )}
          {photos.length > 1 && (
            <>
              <IconButton
                type="button"
                variant="secondary"
                size="icon"
                label={t("previous")}
                className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full"
                onClick={() => step(-1)}
              >
                <CaretLeftIcon aria-hidden="true" />
              </IconButton>
              <IconButton
                type="button"
                variant="secondary"
                size="icon"
                label={t("next")}
                className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full"
                onClick={() => step(1)}
              >
                <CaretRightIcon aria-hidden="true" />
              </IconButton>
              <p className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white tabular-nums">
                {(viewing ?? 0) + 1} / {photos.length}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
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
