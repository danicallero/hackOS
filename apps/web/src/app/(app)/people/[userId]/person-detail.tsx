"use client";

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import Link from "next/link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { UserAvatar } from "@/components/common/user-avatar";
import { CvViewer } from "@/components/profile/cv-viewer";
import { SocialLinks } from "@/components/profile/social-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api, isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { apiAssetUrl, type DirectoryEntry } from "@/lib/directory";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useChallengeNames } from "../person-row";

/** Singular and plural row labels per project kind. */
const PROJECT_KIND: Record<"project" | "workGroup", [MessageKey, MessageKey]> = {
  project: ["publicProfileProject", "publicProfileProjects"],
  workGroup: ["publicProfileWorkGroup", "publicProfileWorkGroups"],
};

/**
 * One opted-in person from `GET /api/directory/:userId` (#934, #935): only
 * someone the reader saved in their diary by scanning; the API answers the
 * same 404 for anyone else.
 */
export function PersonDetail({ userId }: { userId: number }) {
  return <PersonReader userId={userId} />;
}

function PersonReader({ userId }: { userId: number }) {
  const { t } = useLocale();
  const validId = Number.isSafeInteger(userId) && userId > 0;
  const {
    data: entry,
    error,
    refetch,
  } = useLiveQuery(
    (signal) => api.get<DirectoryEntry>(`/api/directory/${userId}`, { signal }),
    domainScope(SSE_TOPICS.DIRECTORY),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["directory", "person", userId], enabled: validId },
  );
  // Hidden and missing profiles share the 404, so both read as "not found".
  const missing = !validId || isNotFoundError(error);

  const back = <ProfileBackLink href="/people" label={t("backToPeople")} />;

  if (!entry || missing) {
    return (
      <PageLayout width="reading">
        {!missing && !error ? (
          <div className="flex items-start gap-3" aria-busy="true">
            <Skeleton className="size-16 rounded-full" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        ) : (
          <>
            <PageHeader context={back} title={missing ? t("personNotFound") : t("columnPeople")} />
            {missing ? (
              <EmptyState title={t("personNotFound")} />
            ) : (
              <ContextualError
                message={apiErrorText(error, t, t("couldNotLoadPerson"))}
                onRetry={() => refetch()}
              />
            )}
          </>
        )}
      </PageLayout>
    );
  }

  return <PersonProfile entry={entry} context={back} />;
}

/** The labelled return link above a profile's name. */
export function ProfileBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}

/**
 * A person's public profile as the people allowed to read it see it: the
 * scanned-person page and the help desk's helper page (H63) render the same
 * component, with their own context link and any extra sections as children.
 */
export function PersonProfile({
  entry,
  context,
  children,
  visibleRole,
  company,
  present,
}: {
  visibleRole?: string | null;
  company?: { name: string; logoUrl: string | null };
  present?: boolean;
  entry: DirectoryEntry;
  context: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { t } = useLocale();
  const { nameOf } = useChallengeNames();
  const rows: { id: string; label: string; value: React.ReactNode }[] = [];
  if (company)
    rows.push({
      id: "company",
      label: t("helpDeskCompany"),
      value: (
        <div className="flex min-w-0 items-center gap-3">
          {company.logoUrl ? (
            // biome-ignore lint/performance/noImgElement: authenticated enterprise logo URL.
            <img
              src={apiAssetUrl(company.logoUrl)}
              alt=""
              className="size-10 shrink-0 object-contain"
            />
          ) : null}
          <span className="wrap-anywhere">{company.name}</span>
        </div>
      ),
    });
  if (entry.helpTopics?.length)
    rows.push({
      id: "knowledge",
      label: t("helpDeskKnowledge"),
      value: (
        <p className="wrap-anywhere">{entry.helpTopics.map((topic) => topic.name).join(" · ")}</p>
      ),
    });
  if (entry.socials.length > 0) {
    rows.push({
      id: "links",
      label: t("publicProfileLinks"),
      value: <SocialLinks links={entry.socials} />,
    });
  }
  if (entry.locationNote) {
    rows.push({
      id: "location",
      label: t("publicProfileLocation"),
      value: <p className="wrap-anywhere">{entry.locationNote}</p>,
    });
  }
  // Every project and work group the person is in, one row per kind (#935).
  for (const kind of ["project", "workGroup"] as const) {
    const projects = entry.projects.filter((project) => project.kind === kind);
    if (projects.length === 0) continue;
    const [one, many] = PROJECT_KIND[kind];
    rows.push({
      id: kind,
      label: t(projects.length === 1 ? one : many),
      value: (
        <ul className="space-y-1">
          {projects.map((project) => (
            <li key={project.id} className="wrap-anywhere">
              {project.name}
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (entry.challenges.length > 0) {
    rows.push({
      id: "challenges",
      label: t("challenges"),
      value: (
        <p className="wrap-anywhere">
          {entry.challenges.map((challenge) => nameOf(challenge)).join(", ")}
        </p>
      ),
    });
  }

  return (
    <PageLayout width="reading">
      <PageHeader
        context={context}
        leading={
          <UserAvatar
            name={entry.displayName}
            image={entry.photoUrl}
            className="size-16"
            fallbackClassName="text-lg"
            showInitials
            decorative
            presenceLabel={present ? t("helpDeskPresent") : undefined}
          />
        }
        title={entry.displayName}
        meta={
          entry.headline ? (
            <span className="text-muted-foreground wrap-anywhere text-sm">{entry.headline}</span>
          ) : undefined
        }
        secondaryActions={
          visibleRole ? <Badge variant="secondary">{visibleRole}</Badge> : undefined
        }
        primaryAction={
          entry.cvUrl ? (
            <CvViewer
              path={entry.cvUrl}
              name={entry.displayName}
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <FilePdfIcon aria-hidden="true" />
                  {t("viewCv")}
                </Button>
              }
            />
          ) : undefined
        }
      />
      {entry.bio && (
        <p className="max-w-prose whitespace-pre-line wrap-anywhere text-pretty">{entry.bio}</p>
      )}
      {rows.length > 0 && (
        <dl className="divide-y divide-border/60">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid min-w-0 gap-1 py-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
            >
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </PageLayout>
  );
}
