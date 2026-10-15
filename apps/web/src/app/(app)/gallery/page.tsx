import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/ssr/FolderSimple";
import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { PageLayout } from "@/components/common/page-layout";
import { ProjectsSectionHeader } from "@/components/common/section-navigation";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { NativeProject } from "@/lib/native-projects";
import { galleryContext } from "./data";
import { GalleryProjectCard } from "./gallery-project-card";
import { GalleryRefresh } from "./gallery-refresh";
import { GalleryToolbar } from "./gallery-toolbar";

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
  return { title: copy.projectGallery, robots: { index: false, follow: false } };
}
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    challengeId?: string;
    page?: string;
    winnersOnly?: string;
  }>;
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
        query: {
          search: query.search,
          challengeId: query.challengeId,
          page: query.page,
          winnersOnly: query.winnersOnly,
        },
      }),
      api.get<{ items: GalleryChallenge[] }>("/api/public/challenges", options),
    ]);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const closed = galleryClosedNotice(error, copy, language);
    return (
      <PageLayout>
        <GalleryRefresh />
        <ProjectsSectionHeader />
        {closed ? (
          <p className="text-muted-foreground">{closed}</p>
        ) : (
          <p role="alert">{apiErrorText(error, t, t("apiErrorServer"))}</p>
        )}
      </PageLayout>
    );
  }
  return (
    <PageLayout>
      <GalleryRefresh />
      <ProjectsSectionHeader />
      <GalleryToolbar
        key={`${query.search ?? ""}:${query.challengeId ?? ""}:${query.winnersOnly ?? ""}`}
        search={query.search ?? ""}
        challengeId={query.challengeId ?? ""}
        winnersOnly={query.winnersOnly === "true"}
        challenges={catalogue.map((challenge) => ({
          id: challenge.id,
          title: challenge.title[language] ?? Object.values(challenge.title)[0],
        }))}
      />
      <div className="grid auto-rows-fr gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {result.items.map((project) => (
          <GalleryProjectCard
            key={project.id}
            project={project}
            showCover={result.items.some((item) =>
              item.files?.some((file) => file.mimeType.startsWith("image/")),
            )}
          />
        ))}
      </div>
      {result.total > result.pageSize && (
        <nav aria-label={copy.projectGallery} className="flex gap-3">
          {result.page > 1 && (
            <Button asChild variant="outline">
              <Link href={{ pathname: "/gallery", query: { ...query, page: result.page - 1 } }}>
                <ArrowLeftIcon aria-hidden="true" />
                {copy.previous}
              </Link>
            </Button>
          )}
          {result.page * result.pageSize < result.total && (
            <Button asChild variant="outline">
              <Link href={{ pathname: "/gallery", query: { ...query, page: result.page + 1 } }}>
                {copy.next}
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
          )}
        </nav>
      )}
      {result.items.length === 0 && (
        <EmptyState
          icon={FolderSimpleIcon}
          title={
            query.search || query.challengeId || query.winnersOnly === "true"
              ? copy.noMatchesTitle
              : copy.noProjectsYet
          }
        />
      )}
    </PageLayout>
  );
}
