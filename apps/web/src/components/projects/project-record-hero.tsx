"use client";

import { usePathname } from "next/navigation";
import { BackLink } from "@/components/common/back-link";
import { HeroBleed } from "@/components/common/hero-bleed";
import { useLogoColor } from "@/lib/company";
import { useLocale } from "@/lib/i18n";
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
      <header className="flex flex-col gap-4 pt-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-3">
          <h1 className="font-display text-3xl leading-tight text-balance wrap-anywhere sm:text-5xl">
            {name}
          </h1>
          {state}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
    </HeroBleed>
  );
}
