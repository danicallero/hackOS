"use client";

import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n";

/** Thumbnail that opens the full image in a lightbox instead of a new tab. */
export function ProjectImage({
  thumbnailSrc,
  src,
  alt,
}: {
  thumbnailSrc: string;
  src: string;
  alt: string;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={alt}
        className="cursor-zoom-in overflow-hidden rounded-frame border border-border/60 bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {/* biome-ignore lint/performance/noImgElement: policy-checked project images bypass shared optimizer caches. */}
        <img
          src={thumbnailSrc}
          alt={alt}
          className="aspect-video w-full object-contain"
          loading="lazy"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[min(90vw,72rem)] items-center gap-3 p-3">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {/* biome-ignore lint/performance/noImgElement: policy-checked project images bypass shared optimizer caches. */}
          <img src={src} alt={alt} className="max-h-[80dvh] min-h-0 w-full object-contain" />
          <Button asChild variant="outline" size="sm">
            <a href={src} target="_blank" rel="noreferrer">
              <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
              {t("openInNewTab")}
            </a>
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
