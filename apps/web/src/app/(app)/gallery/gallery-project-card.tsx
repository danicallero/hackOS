"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import Link from "next/link";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiAssetUrl } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";
import { projectSummary } from "@/lib/project-text";

/** H18/H60: equal catalogue cards; the challenge disclosure never changes grid height. */
export function GalleryProjectCard({
  project,
  showCover,
}: {
  project: NativeProject;
  showCover: boolean;
}) {
  const { language, t } = useLocale();
  const cover = project.files?.find((file) => file.mimeType.startsWith("image/"));
  const challenges = project.challenges.map((challenge) => ({
    id: challenge.id,
    title:
      typeof challenge.title === "string"
        ? challenge.title
        : (challenge.title[language] ?? challenge.title.en),
  }));
  const members = project.members.filter((member) => member.status === "active");
  return (
    <SectionCard
      title={<span className="line-clamp-2">{project.name}</span>}
      icon={FolderSimpleIcon}
      className="flex h-full min-w-0 flex-col"
      bodyClassName="flex-1 space-y-3"
      footerClassName="justify-between gap-3"
      footer={
        <>
          <AvatarGroup aria-label={t("surfaceTeam")}>
            {members.slice(0, 5).map((member) => (
              <Avatar
                key={member.userId}
                role="img"
                aria-label={member.name ?? t("surfaceTeam")}
                title={member.name ?? undefined}
              >
                {member.photoUrl && <AvatarImage src={apiAssetUrl(member.photoUrl)} alt="" />}
                <AvatarFallback>
                  <UserIcon aria-hidden="true" className="size-4" />
                </AvatarFallback>
              </Avatar>
            ))}
            {members.length > 5 && <AvatarGroupCount>+{members.length - 5}</AvatarGroupCount>}
          </AvatarGroup>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/gallery/${project.id}`}
              aria-label={`${t("openProject")}: ${project.name}`}
            >
              {t("openProject")}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </>
      }
    >
      {showCover && (
        <div className="aspect-video overflow-hidden rounded-md bg-muted">
          {cover && (
            // biome-ignore lint/performance/noImgElement: policy-checked assets must avoid optimizer caches.
            <img
              src={apiAssetUrl(cover.thumbnailUrl ?? cover.url)}
              alt=""
              className="size-full object-cover"
            />
          )}
        </div>
      )}
      <p className="line-clamp-2 min-h-[2lh] text-sm text-muted-foreground text-pretty">
        {projectSummary(project.description, project.name)}
      </p>
      {challenges.length > 0 && (
        <div className="flex items-start justify-between gap-3">
          <p className="line-clamp-2 min-h-[2lh] min-w-0 text-sm text-muted-foreground">
            {challenges
              .slice(0, 2)
              .map((challenge) => challenge.title)
              .join(" · ")}
          </p>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0">
                <TrophyIcon aria-hidden="true" />
                {t("projectChallengesCount", { count: challenges.length })}
                <CaretDownIcon aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
            >
              <h3 className="mb-3 font-medium">{t("challenges")}</h3>
              <ul className="space-y-3">
                {challenges.map((challenge) => (
                  <li key={challenge.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 wrap-anywhere text-sm">{challenge.title}</span>
                    <Button asChild variant="ghost" size="icon-sm">
                      <Link href={`/challenge/${challenge.id}`} aria-label={challenge.title}>
                        <ArrowRightIcon aria-hidden="true" />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      )}
      {project.winners?.map((winner) => (
        <StatusBadge key={winner.challengeId} tone="success" dot={false} className="max-w-full">
          <TrophyIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="wrap-anywhere">
            {winner.challengeTitle} · {t("rankLabel", { rank: winner.rank })}
          </span>
        </StatusBadge>
      ))}
    </SectionCard>
  );
}
