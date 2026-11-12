"use client";

import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import Link from "next/link";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiAssetUrl } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import type { NativeProject } from "@/lib/native-projects";
import { projectSummary } from "@/lib/project-text";

/** H18/H60: catalogue cards keep real content compact and disclosures out of the grid flow. */
export function GalleryProjectCard({ project }: { project: NativeProject }) {
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
      title={
        <Link
          href={`/gallery/${project.id}`}
          className="line-clamp-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          {project.name}
        </Link>
      }
      className="flex h-full min-w-0 flex-col"
      bodyClassName="flex-1 space-y-3"
      footerClassName="justify-between gap-3"
      footer={
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {members
              .filter((member) => member.photoUrl)
              .slice(0, 3)
              .map((member) => (
                <UserAvatar
                  key={member.userId}
                  name={member.name ?? ""}
                  image={member.photoUrl}
                  className="size-7"
                  decorative
                />
              ))}
            <p className="min-w-0 line-clamp-2 text-sm text-muted-foreground">
              {members
                .map((member) => [member.name, member.surname].filter(Boolean).join(" "))
                .filter(Boolean)
                .join(", ")}
            </p>
          </div>
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
      {cover && (
        <div className="aspect-video overflow-hidden rounded-md bg-muted">
          {/* biome-ignore lint/performance/noImgElement: policy-checked assets must avoid optimizer caches. */}
          <img
            src={apiAssetUrl(cover.thumbnailUrl ?? cover.url)}
            alt=""
            className="size-full object-cover"
          />
        </div>
      )}
      {projectSummary(project.description, project.name) && (
        <p className="line-clamp-2 text-sm text-muted-foreground text-pretty">
          {projectSummary(project.description, project.name)}
        </p>
      )}
      {challenges.length > 0 && (
        <div className="flex items-start justify-between gap-3">
          <p className="line-clamp-2 min-h-[2lh] min-w-0 text-sm text-muted-foreground">
            {challenges.slice(0, 2).map((challenge, index) => (
              <span key={challenge.id}>
                {index > 0 && " · "}
                <Link
                  href={`/challenge/${challenge.id}`}
                  className="hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {challenge.title}
                </Link>
              </span>
            ))}
          </p>
          {challenges.length > 2 && (
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
                <h3 className="type-subheading mb-3">{t("challenges")}</h3>
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
          )}
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
