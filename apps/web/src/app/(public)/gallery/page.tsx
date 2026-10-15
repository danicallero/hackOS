import Link from "next/link";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { NativeProject } from "@/lib/native-projects";
import { galleryContext, projectAssetUrl } from "./data";
import { GalleryRefresh } from "./gallery-refresh";

interface GalleryChallenge {
  id: number;
  title: Record<string, string>;
}

/** H18: a gallery that is not open yet is a date, not a permission error. */
function galleryClosedNotice(
  error: ApiError,
  copy: { galleryNotOpen: string; galleryOpensOn: string },
  language: string,
) {
  const details = error.details as
    | { reason?: string; opensAt?: string | null; timeZone?: string }
    | undefined;
  if (error.status !== 403 || !details?.reason?.startsWith("gallery_")) return null;
  if (details.reason !== "gallery_closed" || !details.opensAt) return copy.galleryNotOpen;
  const date = new Intl.DateTimeFormat(language, {
    dateStyle: "long",
    timeStyle: "short",
    // Server component: the client-side event-time store is unavailable here.
    timeZone: details.timeZone || "UTC",
  }).format(new Date(details.opensAt));
  return copy.galleryOpensOn.replace("{date}", date);
}

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const { copy } = await galleryContext();
  return { title: `${copy.projectGallery} | hackOS`, robots: { index: false, follow: false } };
}
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; challengeId?: string; page?: string }>;
}) {
  const { copy, language, options, t } = await galleryContext();
  const query = await searchParams;
  let result: { items: NativeProject[]; total: number; page: number; pageSize: number };
  let catalogue: GalleryChallenge[];
  try {
    // H16/H17: the filter lists every challenge the viewer may see, not only those on this page.
    [result, { items: catalogue }] = await Promise.all([
      api.get<typeof result>("/api/public/projects", {
        ...options,
        query: { search: query.search, challengeId: query.challengeId, page: query.page },
      }),
      api.get<{ items: GalleryChallenge[] }>("/api/public/challenges", options),
    ]);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const closed = galleryClosedNotice(error, copy, language);
    return (
      <PageLayout className="px-4 py-6 sm:px-6">
        <GalleryRefresh />
        <PageHeader title={copy.projectGallery} />
        {closed ? (
          <p className="text-muted-foreground">{closed}</p>
        ) : (
          <p role="alert">{apiErrorText(error, t, t("apiErrorServer"))}</p>
        )}
      </PageLayout>
    );
  }
  return (
    <PageLayout className="px-4 py-6 sm:px-6">
      <GalleryRefresh />
      <PageHeader title={copy.projectGallery} />
      <form className="flex flex-wrap gap-2" action="/gallery">
        <label className="sr-only" htmlFor="gallery-search">
          {copy.search}
        </label>
        <Input id="gallery-search" name="search" defaultValue={query.search} />
        <label className="sr-only" htmlFor="gallery-challenge">
          {copy.challenges}
        </label>
        <select
          id="gallery-challenge"
          name="challengeId"
          defaultValue={query.challengeId ?? ""}
          className="rounded-md border bg-background px-3"
        >
          <option value="">{copy.challenges}</option>
          {catalogue.map((challenge) => (
            <option key={challenge.id} value={challenge.id}>
              {challenge.title[language] ?? Object.values(challenge.title)[0]}
            </option>
          ))}
        </select>
        <Button type="submit">{copy.search}</Button>
      </form>
      <div className="grid items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {result.items.map((project) => (
          <SectionCard
            key={project.id}
            title={<Link href={`/gallery/${project.id}`}>{project.name}</Link>}
          >
            {project.files?.find((file) => file.mimeType.startsWith("image/")) && (
              // biome-ignore lint/performance/noImgElement: policy-checked assets must avoid the optimizer cache.
              <img
                src={projectAssetUrl(
                  project.files.find((file) => file.mimeType.startsWith("image/"))!.thumbnailUrl ??
                    project.files.find((file) => file.mimeType.startsWith("image/"))!.url,
                )}
                alt=""
                className="mb-3 aspect-video w-full rounded-md object-cover"
              />
            )}
            {project.winners?.map((winner) => (
              <p className="mb-2 text-sm font-medium" key={winner.challengeId}>
                {winner.challengeTitle} · {winner.rank}
              </p>
            ))}
            {project.description && <p className="text-sm text-pretty">{project.description}</p>}
            <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
              {project.challenges.map((challenge) => (
                <li key={challenge.id}>
                  {typeof challenge.title === "string"
                    ? challenge.title
                    : challenge.title[language]}
                </li>
              ))}
            </ul>
          </SectionCard>
        ))}
      </div>
      {result.total > result.pageSize && (
        <nav aria-label={copy.projectGallery} className="flex gap-3">
          {result.page > 1 && (
            <Button asChild variant="outline">
              <Link href={{ pathname: "/gallery", query: { ...query, page: result.page - 1 } }}>
                {copy.previous}
              </Link>
            </Button>
          )}
          {result.page * result.pageSize < result.total && (
            <Button asChild variant="outline">
              <Link href={{ pathname: "/gallery", query: { ...query, page: result.page + 1 } }}>
                {copy.next}
              </Link>
            </Button>
          )}
        </nav>
      )}
      {result.items.length === 0 && <p>{copy.noProjectsYet}</p>}
    </PageLayout>
  );
}
