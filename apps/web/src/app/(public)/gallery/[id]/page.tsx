import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
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
      title: `${project.name} | hackOS`,
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
    <PageLayout className="px-4 py-6 sm:px-6">
      <GalleryRefresh />
      <PageHeader title={project.name} context={<Link href="/gallery">{copy.projects}</Link>} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard title={copy.projectDetailsTitle}>
          {project.winners?.map((winner) => (
            <p className="mb-3 font-medium" key={winner.challengeId}>
              {winner.challengeTitle} · {winner.rank}
            </p>
          ))}
          <dl className="space-y-5">
            {project.template.map((field) => {
              const value = project.responses[field.key];
              const file = project.files?.find((file) => file.fieldKey === field.key);
              const label = field.label[language] || field.label.en;
              const text = Array.isArray(value)
                ? value
                    .map(
                      (item) =>
                        field.options?.find((option) => option.value === item)?.label[language] ??
                        String(item),
                    )
                    .join(", ")
                : String(value ?? "");
              const url =
                field.validation?.text_condition === "url" && text
                  ? /^https?:\/\//i.test(text)
                    ? text
                    : `https://${text}`
                  : null;
              return (
                <div key={field.key}>
                  <dt className="mb-1 font-medium">{label}</dt>
                  <dd className="whitespace-pre-wrap text-sm text-pretty">
                    {file ? (
                      file.mimeType.startsWith("image/") ? (
                        // biome-ignore lint/performance/noImgElement: policy checked images must avoid shared optimizer caches.
                        <img
                          src={projectAssetUrl(file.url)}
                          alt={label}
                          className="w-full rounded-md object-contain"
                        />
                      ) : (
                        <a
                          href={projectAssetUrl(file.url)}
                          className="underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {file.fileName}
                        </a>
                      )
                    ) : url ? (
                      <a href={url} className="underline" target="_blank" rel="noreferrer">
                        {text}
                      </a>
                    ) : (
                      text
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </SectionCard>
        <SectionCard title={copy.surfaceTeam}>
          <ul className="divide-y divide-border/60">
            {project.members.map((member) => (
              <li className="flex items-center gap-3 py-3" key={member.userId}>
                {member.photoUrl && (
                  // biome-ignore lint/performance/noImgElement: the policy-checked photo URL must not enter the image optimizer cache.
                  <img
                    src={projectAssetUrl(member.photoUrl)}
                    alt=""
                    className="size-10 rounded-full object-cover"
                  />
                )}
                <span>{member.name}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </PageLayout>
  );
}
