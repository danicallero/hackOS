import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageLayout } from "@/components/common/page-layout";
import { ProjectsSectionHeader } from "@/components/common/section-navigation";
import { ProjectOverview } from "@/components/projects/project-overview";
import { ProjectRecordActions } from "@/components/projects/project-record-actions";
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
          <ProjectRecordActions
            id={project.id}
            isMember={project.isMember === true || project.canEdit}
            canInspect={project.canInspect === true}
          />
        }
      />
      <ProjectOverview
        showQueue={project.isMember === true || project.canInspect === true}
        project={project}
        language={language}
        assetUrl={projectAssetUrl}
        labels={{
          team: copy.surfaceTeam,
          challenges: copy.challenges,
          details: copy.projectDetailsTitle,
          pending: copy.pendingInvitesTitle,
          rank: copy.rankLabel,
          noMembers: copy.noMembers,
          noChallenges: copy.noChallenges,
        }}
      />
    </PageLayout>
  );
}
