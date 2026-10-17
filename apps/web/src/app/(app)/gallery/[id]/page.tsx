import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { TrophyIcon } from "@phosphor-icons/react/dist/ssr/Trophy";
import { UsersIcon } from "@phosphor-icons/react/dist/ssr/Users";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { ProjectsSectionHeader } from "@/components/common/section-navigation";
import { StatusBadge } from "@/components/common/status-badge";
import { UserAvatar } from "@/components/common/user-avatar";
import { ProjectAnswers } from "@/components/projects/project-answers";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { SITE_URL, SOCIAL_IMAGE_PATH } from "@/lib/metadata";
import { galleryProject, projectAssetUrl } from "../data";
import { GalleryRefresh } from "../gallery-refresh";

export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  try {
    const { project } = await galleryProject((await params).id);
    const image = project.files?.find((file) => file.mimeType.startsWith("image/"));
    return {
      title: project.name,
      alternates: { canonical: new URL(`/gallery/${project.id}`, SITE_URL).toString() },
      description: project.description ?? undefined,
      openGraph: {
        title: project.name,
        url: new URL(`/gallery/${project.id}`, SITE_URL).toString(),
        description: project.description ?? undefined,
        images: [
          image
            ? projectAssetUrl(image.thumbnailUrl ?? image.url)
            : new URL(SOCIAL_IMAGE_PATH, SITE_URL).toString(),
        ],
      },
      robots: { index: false, follow: false },
    };
  } catch {
    return { robots: { index: false, follow: false } };
  }
}
export default async function ProjectGalleryPage({ params }: { params: Promise<{ id: string }> }) {
  let data: Awaited<ReturnType<typeof galleryProject>>;
  try {
    data = await galleryProject((await params).id);
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound();
    throw error;
  }
  const { project, copy, language } = data;
  return (
    <PageLayout>
      <GalleryRefresh />
      <ProjectsSectionHeader
        recordName={project.name}
        recordAction={
          project.canEdit ? (
            <Button asChild>
              <Link href={`/my-project/${project.id}?edit=1`}>{copy.editProjectDetails}</Link>
            </Button>
          ) : undefined
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
        <div className="min-w-0 space-y-6">
          {project.winners?.map((winner) => (
            <StatusBadge
              tone="success"
              dot={false}
              className="mb-3 max-w-full"
              key={winner.challengeId}
            >
              <TrophyIcon aria-hidden="true" className="size-4 shrink-0" />
              <span className="wrap-anywhere">
                {winner.challengeTitle} · {copy.rankLabel.replace("{rank}", String(winner.rank))}
              </span>
            </StatusBadge>
          ))}
          <ProjectAnswers
            project={project}
            language={language}
            fallbackTitle={copy.projectDetailsTitle}
            assetUrl={projectAssetUrl}
          />
        </div>
        <div className="min-w-0 space-y-6 lg:sticky lg:top-6">
          <SectionCard title={copy.surfaceTeam} icon={UsersIcon} variant="plain">
            <ul className="divide-y divide-border/60">
              {project.members.map((member) => (
                <li className="flex items-center gap-3 py-3" key={member.userId}>
                  {member.photoUrl && (
                    <UserAvatar
                      name={member.name ?? copy.surfaceTeam}
                      image={member.photoUrl ? projectAssetUrl(member.photoUrl) : null}
                      className="size-10"
                      fallbackClassName="bg-secondary"
                      decorative
                    />
                  )}
                  <span>{member.name}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
          <SectionCard title={copy.challenges} icon={TrophyIcon} variant="plain">
            <ul className="divide-y divide-border/60">
              {project.challenges.map((challenge) => (
                <li key={challenge.id}>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-9 w-full justify-between whitespace-normal rounded-control px-2 py-3 text-left"
                  >
                    <Link href={`/challenge/${challenge.id}`}>
                      <TrophyIcon aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        {typeof challenge.title === "string"
                          ? challenge.title
                          : (challenge.title[language] ?? challenge.title.en)}
                      </span>
                      <ArrowRightIcon aria-hidden="true" />
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>
    </PageLayout>
  );
}
