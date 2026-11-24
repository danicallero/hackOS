"use client";

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { mascotAvatarChoice } from "@hackos/shared/mascot-avatars";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { HeroBleed } from "@/components/common/hero-bleed";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { PageTitle } from "@/components/common/page-title";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { UserAvatar } from "@/components/common/user-avatar";
import { CvViewer } from "@/components/profile/cv-viewer";
import { SocialLinks } from "@/components/profile/social-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api, isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { precomputeLogoColor } from "@/lib/company";
import { eventDateFormat } from "@/lib/datetime";
import { apiAssetUrl, type DirectoryEntry, personCompanies } from "@/lib/directory";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { type DiaryEntry, PersonActions, useDiaryMutations } from "../diary-actions";
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
export function PersonDetail({ userId, companyId }: { userId: number; companyId?: number }) {
  return <PersonReader userId={userId} companyId={companyId} />;
}

function PersonReader({ userId, companyId }: { userId: number; companyId?: number }) {
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
  // The reader's own diary entry for this person: favorite, note and removal.
  const { data: diary } = useLiveQuery(
    (signal) => api.get<{ items: DiaryEntry[] }>("/api/me/diary", { signal }),
    domainScope(SSE_TOPICS.DIRECTORY),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["me", "diary"], enabled: validId },
  );
  const [override, setOverride] = useState<DiaryEntry | null>(null);
  const [removedId, setRemovedId] = useState<number | null>(null);
  const saved = diary?.items.find((item) => item.person?.userId === userId);
  const mark =
    saved && saved.id !== removedId ? (override?.id === saved.id ? override : saved) : null;
  const { handlers, dialogs } = useDiaryMutations({
    onReplace: setOverride,
    onRemoved: useCallback((id: number) => setRemovedId(id), []),
  });
  // Hidden and missing profiles share the 404, so both read as "not found".
  const missing = !validId || isNotFoundError(error);

  const company = entry && personCompanies(entry).find((item) => item.id === companyId);
  const fromCompany = Number.isSafeInteger(companyId) && (companyId ?? 0) > 0;
  const back = fromCompany ? (
    <BackLink href={`/companies/${companyId}`} label={company?.name ?? t("helpDeskCompany")} />
  ) : (
    <BackLink href="/people" label={t("diary")} />
  );

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

  return (
    <>
      <PersonProfile
        entry={entry}
        context={back}
        actions={
          mark ? (
            <PersonActions name={entry.displayName} mark={mark} handlers={handlers} />
          ) : undefined
        }
      />
      {dialogs}
    </>
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
  present,
  actions,
}: {
  /** Trailing controls of the top row (favorite, menu). */
  actions?: React.ReactNode;
  visibleRole?: string | null;
  present?: boolean;
  entry: DirectoryEntry;
  context: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { t } = useLocale();
  const { nameOf } = useChallengeNames();
  const { language } = useLocale();
  // The avatar's own URL and request (no CORS), so the private photo is fetched
  // and cached only as the avatar already is (H48, #934).
  const photo = entry.photoUrl ? apiAssetUrl(entry.photoUrl) : null;
  const companies = useMemo(() => personCompanies(entry), [entry]);
  useEffect(() => {
    for (const c of companies) precomputeLogoColor(c.logoUrl);
  }, [companies]);
  const talks = entry.activities ?? [];
  const day = eventDateFormat(language, "weekdayDayMonthText");
  const clock = eventDateFormat(language, "clock");
  const rows: { id: string; label: string; value: React.ReactNode }[] = [];
  if (companies.length > 0)
    rows.push({
      id: "companies",
      label: t(companies.length === 1 ? "helpDeskCompany" : "profileCompanies"),
      value: (
        <ul className="space-y-1">
          {companies.map((c) => (
            <li key={c.id}>
              <Link
                href={`/companies/${c.id}`}
                className="row-link flex min-w-0 items-center gap-3 py-1.5"
              >
                {c.logoUrl ? (
                  <SponsorLogo
                    logoUrl={c.logoUrl}
                    logoNegativeUrl={c.logoNegativeUrl}
                    alt=""
                    className="max-h-8 max-w-14 shrink-0 object-contain"
                    inset={false}
                  />
                ) : null}
                <span className="wrap-anywhere">{c.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ),
    });
  if (talks.length > 0)
    rows.push({
      id: "talks",
      label: t("profileTalks"),
      value: (
        <ul className="space-y-1">
          {talks.map((talk) => (
            <li key={talk.id}>
              <Link href={`/timetable?activity=${talk.id}`} className="row-link block py-1.5">
                <span className="block wrap-anywhere font-medium">{talk.title}</span>
                <span className="block text-xs text-muted-foreground capitalize">
                  {day.format(new Date(talk.startsAt))} · {clock.format(new Date(talk.startsAt))}
                  {talk.location ? ` · ${talk.location}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
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
    <>
      <HeroBleed
        color={entry.photoColor ?? mascotAvatarChoice(entry.userId).background}
        ambient={photo ? { urls: [photo], active: photo } : undefined}
      >
        <div className="flex items-center justify-between gap-3">
          {context}
          <div className="flex items-center gap-2">
            {visibleRole && <Badge variant="secondary">{visibleRole}</Badge>}
            {actions}
          </div>
        </div>
        <header className="flex flex-col items-center gap-3 pt-6 text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
          <UserAvatar
            userId={entry.userId}
            name={entry.displayName}
            image={entry.photoUrl}
            className="size-28 shrink-0 shadow-md ring-4 ring-background/70 sm:size-32"
            decorative
            presenceLabel={present ? t("helpDeskPresent") : undefined}
          />
          <div className="min-w-0 space-y-2">
            <PageTitle title={entry.displayName} />
            <h1 className="font-display text-3xl leading-tight wrap-anywhere sm:text-4xl">
              {entry.displayName}
            </h1>
            {entry.headline && (
              <p className="text-muted-foreground wrap-anywhere text-sm">{entry.headline}</p>
            )}
          </div>
          {entry.cvUrl && (
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
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
            </div>
          )}
        </header>
      </HeroBleed>
      <PageLayout width="reading">
        {entry.bio && (
          <p className="max-w-prose whitespace-pre-line wrap-anywhere text-pretty">{entry.bio}</p>
        )}
        {rows.map((row) => (
          <section
            key={row.id}
            aria-label={row.label}
            className="min-w-0 space-y-2 border-t border-border/60 pt-5 text-sm"
          >
            <h2 className="type-meta font-medium text-muted-foreground">{row.label}</h2>
            <div className="min-w-0 text-base">{row.value}</div>
          </section>
        ))}
        {children}
      </PageLayout>
    </>
  );
}
