"use client";

import { youtubeEmbedUrl } from "@hackos/shared/youtube";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/** H16: an explicit media preview keeps a failed external player from becoming empty space. */
export function ProjectVideo({ value, title }: { value: unknown; title: string }) {
  const { t } = useLocale();
  const [loaded, setLoaded] = useState(false);
  const src = youtubeEmbedUrl(value);
  if (!src) return null;
  const id = src.split("/").at(-1);
  return (
    <div className="w-full min-w-0 space-y-2">
      <div className="aspect-video overflow-hidden rounded-frame border border-border/60 bg-muted">
        {loaded ? (
          <iframe
            src={src}
            title={title}
            className="size-full border-0"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            type="button"
            className="group relative flex size-full items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => setLoaded(true)}
            aria-label={`${t("playVideo")}: ${title}`}
          >
            {/* biome-ignore lint/performance/noImgElement: external video preview is loaded only from the normalized provider ID. */}
            <img
              src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
              alt=""
              className="absolute inset-0 size-full object-cover"
              loading="lazy"
            />
            <span className="relative flex size-14 items-center justify-center rounded-full border border-border bg-background text-foreground group-hover:bg-accent">
              <PlayIcon className="size-6" weight="fill" aria-hidden="true" />
            </span>
          </button>
        )}
      </div>
      <Button asChild variant="link" size="sm" className="h-auto px-0">
        <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer">
          {t("watchOnYoutube")}
          <ArrowSquareOutIcon aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}
