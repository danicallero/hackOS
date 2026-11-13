"use client";

import { usePathname } from "next/navigation";
import { BackLink } from "@/components/common/back-link";
import { HeroBleed } from "@/components/common/hero-bleed";
import { useLogoColor } from "@/lib/company";
import { useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import type { NativeProject } from "@/lib/native-projects";

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
  const gallery = usePathname().startsWith("/gallery");
  const cover = files?.find((file) => file.mimeType.startsWith("image/"));
  // Project assets are authenticated API paths: the sampler sends cookies.
  const color = useLogoColor(cover ? assetUrl(cover.thumbnailUrl ?? cover.url) : null, {
    credentials: true,
  });
  const backHref = management ? "/projects" : gallery ? "/gallery" : "/my-project?view=all";
  const backLabel = t(management ? "manageProjects" : gallery ? "projectGallery" : "myProjects");
  return (
    <HeroBleed color={color} contentClassName="max-w-6xl">
      <BackLink href={backHref} label={backLabel} />
      <header className="grid gap-6 pt-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-8">
        <div className="mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-2xl bg-card shadow-lg ring-1 ring-black/5 lg:mx-0 lg:max-w-none">
          {cover ? (
            // biome-ignore lint/performance/noImgElement: authenticated API asset.
            <img
              src={assetUrl(cover.url)}
              alt=""
              crossOrigin="use-credentials"
              className="size-full object-cover"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-6xl font-medium text-muted-foreground">
              {initials(name)}
            </span>
          )}
        </div>
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
