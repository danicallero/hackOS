"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { FilePdfIcon } from "@phosphor-icons/react/dist/csr/FilePdf";
import { UserIcon } from "@phosphor-icons/react/dist/csr/User";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { SocialLinks } from "@/components/profile/social-links";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { apiAssetUrl, type DirectoryEntry } from "@/lib/directory";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useCan } from "@/lib/session";
import { type ChallengeOption, challengeTitleText } from "../../projects/shared";

type State =
  | { status: "loading" }
  | { status: "ready"; entry: DirectoryEntry }
  | { status: "missing" }
  | { status: "error"; message: string };

const PROJECT_KIND: Record<"project" | "workGroup", MessageKey> = {
  project: "publicProfileProject",
  workGroup: "publicProfileWorkGroup",
};

/** One opted-in person from `GET /api/directory/:userId` (#934, #935). */
export function PersonDetail({ userId }: { userId: number }) {
  const { t } = useLocale();
  const canRead = useCan(CAPABILITIES.DIRECTORY_READ);
  // Gate before mounting the reader, so no request or stream opens without access.
  if (!canRead) return <AccessDenied ask={t("peopleAccessDeniedDesc")} />;
  return <PersonReader userId={userId} />;
}

function PersonReader({ userId }: { userId: number }) {
  const { t, language } = useLocale();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const liveRefresh = useAutoRefresh(`/api/events/stream?topic=${SSE_TOPICS.DIRECTORY}`, [
    EVENTS.DOMAIN_CHANGED,
  ]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ items: ChallengeOption[] }>("/api/public/challenges")
      .then((r) => {
        if (!cancelled) setChallenges(r.items);
      })
      .catch(() => {
        // Challenge chips fall back to the names the directory returns.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh and retryNonce are ping-only nonces that retrigger this read.
  useEffect(() => {
    let cancelled = false;
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      setState({ status: "missing" });
      return;
    }
    api
      .get<DirectoryEntry>(`/api/directory/${userId}`)
      .then((entry) => {
        if (!cancelled) setState({ status: "ready", entry });
      })
      .catch((err) => {
        if (cancelled) return;
        // Hidden and missing profiles share the 404, so both read as "not found".
        if (err instanceof ApiError && err.status === 404) setState({ status: "missing" });
        else {
          setState({
            status: "error",
            message: err instanceof ApiError ? err.message : t("couldNotLoadPerson"),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId, liveRefresh, retryNonce, t]);

  const titles = useMemo(
    () => new Map(challenges.map((c) => [c.id, challengeTitleText(c.title, language)])),
    [challenges, language],
  );

  const back = (
    <Link
      href="/people"
      className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      {t("backToPeople")}
    </Link>
  );

  if (state.status !== "ready") {
    return (
      <PageLayout width="reading">
        {state.status === "loading" ? (
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
            <PageHeader
              context={back}
              title={state.status === "missing" ? t("personNotFound") : t("columnPeople")}
            />
            {state.status === "missing" ? (
              <EmptyState icon={UserIcon} title={t("personNotFound")} />
            ) : (
              <ContextualError
                message={state.message}
                onRetry={() => setRetryNonce((value) => value + 1)}
              />
            )}
          </>
        )}
      </PageLayout>
    );
  }

  const { entry } = state;
  const rows: { id: string; label: string; value: React.ReactNode }[] = [];
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
  if (entry.project) {
    rows.push({
      id: "project",
      label: t(PROJECT_KIND[entry.project.kind]),
      value: <p className="wrap-anywhere">{entry.project.name}</p>,
    });
  }
  if (entry.challenges.length > 0) {
    rows.push({
      id: "challenges",
      label: t("challenges"),
      value: (
        <ul className="flex flex-wrap gap-1.5">
          {entry.challenges.map((challenge) => (
            <li
              key={challenge.id}
              className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs"
            >
              {titles.get(challenge.id) || challenge.name}
            </li>
          ))}
        </ul>
      ),
    });
  }

  return (
    <PageLayout width="reading">
      <PageHeader
        context={back}
        leading={
          <Avatar className="size-16">
            {entry.photoUrl && (
              <AvatarImage src={apiAssetUrl(entry.photoUrl)} alt={entry.displayName} />
            )}
            <AvatarFallback className="text-lg">{initials(entry.displayName)}</AvatarFallback>
          </Avatar>
        }
        title={entry.displayName}
        meta={
          entry.headline ? (
            <span className="text-muted-foreground wrap-anywhere text-sm">{entry.headline}</span>
          ) : undefined
        }
        primaryAction={
          entry.cvUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={apiAssetUrl(entry.cvUrl)} target="_blank" rel="noreferrer">
                <FilePdfIcon aria-hidden="true" />
                {t("downloadCv")}
              </a>
            </Button>
          ) : undefined
        }
      />
      {entry.bio && (
        <p className="max-w-prose whitespace-pre-line wrap-anywhere text-pretty">{entry.bio}</p>
      )}
      {rows.length > 0 && (
        <dl className="divide-y divide-border/60 border-y border-border/60">
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
    </PageLayout>
  );
}
