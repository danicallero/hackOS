"use client";

import { usePathname } from "next/navigation";
import { BackLink } from "@/components/common/back-link";
import { HeroBleed } from "@/components/common/hero-bleed";
import { useLogoColor } from "@/lib/company";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";
import { cn } from "@/lib/utils";
import { ProjectCarousel, projectGallery } from "./project-carousel";

/**
 * Tinted top of a project record (H47, H48): back link, title, state and
 * actions on a wash taken from the project's first image, blue when it has
 * none or the colour cannot be read. Place it outside `PageLayout`.
 */
export function ProjectRecordHero({
  name,
  files,
  assetUrl,
  management = false,
  state,
  actions,
}: {
  name: string;
  files: NativeProject["files"];
  assetUrl: (path: string) => string;
  management?: boolean;
  state?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { t } = useLocale();
  const inGallery = usePathname().startsWith("/gallery");
  const gallery = projectGallery(files);
  const cover = gallery?.images[0];
  // Project assets are authenticated API paths: the sampler sends cookies.
  const color = useLogoColor(cover ? assetUrl(cover.thumbnailUrl ?? cover.url) : null, {
    credentials: true,
  });
  const backHref = management ? "/projects" : inGallery ? "/gallery" : "/my-project?view=all";
  const backLabel = t(management ? "manageProjects" : inGallery ? "projectGallery" : "myProjects");
  return (
    <HeroBleed color={color} contentClassName="max-w-6xl">
      <BackLink href={backHref} label={backLabel} />
      <header
        className={cn("grid gap-6 pt-4 lg:gap-8", gallery && "lg:grid-cols-[22rem_minmax(0,1fr)]")}
      >
        {gallery && (
          <ProjectCarousel
            images={gallery.images}
            assetUrl={assetUrl}
            className="mx-auto w-full max-w-sm lg:mx-0 lg:max-w-none"
          />
        )}
        <div className="flex min-w-0 flex-col justify-end gap-4">
          <h1 className="font-display text-3xl leading-tight text-balance wrap-anywhere sm:text-5xl">
            {name}
          </h1>
          {state}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
    </HeroBleed>
  );
}
