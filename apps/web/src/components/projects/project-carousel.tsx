"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { NativeProject } from "@/lib/native-projects";
import { cn } from "@/lib/utils";

type ProjectFile = NonNullable<NativeProject["files"]>[number];

/**
 * The project's cover images: the images of the first form field that has any
 * (the organizer decides which question that is, and how many photos it takes).
 * Null when the project has none, so the page can leave the cover out.
 */
export function projectGallery(
  files: NativeProject["files"],
): { fieldKey: string; images: ProjectFile[] } | null {
  const images = files?.filter((file) => file.mimeType.startsWith("image/")) ?? [];
  const first = images[0];
  if (!first) return null;
  return { fieldKey: first.fieldKey, images: images.filter((f) => f.fieldKey === first.fieldKey) };
}

/** One image, or a swipeable strip with dots when there are several; tap to enlarge. */
export function ProjectCarousel({
  images,
  assetUrl,
  className,
  fit = "cover",
}: {
  images: ProjectFile[];
  assetUrl: (path: string) => string;
  className?: string;
  /** `contain` shows whole screenshots on a muted ground; `cover` fills the frame. */
  fit?: "cover" | "contain";
}) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const current = images[open ? index : 0];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl",
        fit === "contain" ? "bg-muted" : "bg-card shadow-lg",
        className,
      )}
    >
      <ul
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const el = event.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
      >
        {images.map((file) => (
          <li
            key={file.objectKey}
            className={cn(
              "w-full shrink-0 snap-center",
              fit === "contain" ? "aspect-video" : "aspect-[4/3]",
            )}
          >
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="size-full cursor-zoom-in"
              aria-label={file.fileName}
            >
              {/* biome-ignore lint/performance/noImgElement: authenticated project assets. */}
              <img
                src={assetUrl(file.thumbnailUrl ?? file.url)}
                alt=""
                crossOrigin="use-credentials"
                className={cn("size-full", fit === "contain" ? "object-contain" : "object-cover")}
              />
            </button>
          </li>
        ))}
      </ul>
      {images.length > 1 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
        >
          <span className="flex gap-1.5 rounded-full bg-black/35 px-2 py-1 backdrop-blur-sm">
            {images.map((file, i) => (
              <span
                key={file.objectKey}
                className={cn(
                  "size-1.5 rounded-full bg-white/60 shadow-sm",
                  i === index && "bg-white",
                )}
              />
            ))}
          </span>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[min(90vw,72rem)] items-center gap-3 p-3">
          <DialogTitle className="sr-only">{current?.fileName}</DialogTitle>
          {current && (
            // biome-ignore lint/performance/noImgElement: authenticated project assets.
            <img
              src={assetUrl(current.url)}
              alt=""
              crossOrigin="use-credentials"
              className="max-h-[80vh] w-auto max-w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
