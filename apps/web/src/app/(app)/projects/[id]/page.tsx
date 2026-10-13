"use client";

// Project detail with hot-edit membership and challenge entries (H21).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { TrophyIcon } from "@phosphor-icons/react/dist/csr/Trophy";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { ReviewStatusBadge } from "@/components/common/review-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { PresentationStatus } from "@/components/projects/presentation-status";
import { ProjectDescriptionLinks } from "@/components/projects/project-description-links";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { addRepoChallenge, addRepoMember, getRepoById, removeRepoChallenge } from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import { toast } from "@/lib/toast";
import { ProjectFormDialog } from "../project-form-dialog";
import {
  type ChallengeOption,
  challengeTitleText,
  memberName,
  type ProjectRepo,
  toProjectRepo,
} from "../shared";
import { MemberRemoveButton, ProjectChallengeAdder, ProjectMemberAdder } from "./project-actions";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { can, me } = useSessionContext();
  // H8/H44/H46: mirrors the list page's gate (issue #427) — judges + sponsor
  // reps reach a scoped detail view via the same association the backend
  // already checks (requireRepositoryAccess), not just projects:read.
  const canRead =
    can(CAPABILITIES.PROJECTS_READ) || Boolean(me?.isEnterpriseJudge) || Boolean(me?.isSponsorRep);
  const canEdit = can(CAPABILITIES.PROJECTS_EDIT);
  const id = Number(params.id);
  const [repo, setRepo] = useState<ProjectRepo | null>(null);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const [loading, setLoading] = useState(true);

  // A background live-refresh shouldn't flash the whole page away — only
  // the very first load (before there's anything to show) should.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!canRead || !Number.isFinite(id)) {
      setLoading(false);
      return;
    }
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const repoRes = await getRepoById(id);
      setRepo(toProjectRepo(repoRes));
      hasLoadedRef.current = true;

      if (canEdit) {
        const challengeResult = await api
          .get<{ challenges: ChallengeOption[] }>("/api/challenges")
          .catch(() => ({ challenges: [] }));
        setChallenges(challengeResult.challenges);
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotLoadProject"),
        t("projectLabel"),
      );
      setRepo(null);
    } finally {
      setLoading(false);
    }
  }, [canEdit, canRead, id, t]);

  // Soft, in-place refresh instead of a hard reload when this project
  // changes elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=projects", [EVENTS.DOMAIN_CHANGED]);
  const queueRefresh = useAutoRefresh("/api/tv/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetching project/challenge data from API (external-system sync)
    void load();
  }, [load, liveRefresh, queueRefresh]);

  const availableChallenges = useMemo(
    () =>
      challenges.filter(
        (challenge) => !repo?.challenges.some((entered) => entered.id === challenge.id),
      ),
    [challenges, repo],
  );

  if (!canRead) {
    return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!repo) {
    return (
      <PageLayout>
        <PageHeader
          title={t("colProject")}
          actions={
            <Button variant="outline" asChild>
              <Link href="/projects">
                <ArrowLeftIcon aria-hidden="true" className="size-4" />
                {t("projects")}
              </Link>
            </Button>
          }
        />
        <EmptyState icon={FolderSimpleIcon} title={t("projectNotFoundTitle")} />
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader
        title={repo.name}
        secondaryActions={
          <IconButton label={t("projects")} variant="outline" asChild>
            <Link href="/projects">
              <ArrowLeftIcon aria-hidden="true" />
            </Link>
          </IconButton>
        }
        primaryAction={
          /* H21: metadata edit (name, description, links, judging preference). */
          canEdit ? (
            <ProjectFormDialog
              key={`${repo.id}-${repo.name}-${repo.presentation_timing_preference}`}
              mode={{ kind: "edit", repo }}
              onSaved={load}
            />
          ) : undefined
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-4">
          <SectionCard title={t("projectDetailsTitle")}>
            <ProjectDescriptionLinks
              description={repo.description}
              links={{
                demoUrl: repo.demo_url,
                githubUrl: repo.github_url,
              }}
            />
          </SectionCard>
          <SectionCard title={t("teamSectionTitle")} bodyClassName="space-y-4">
            {repo.members.length === 0 ? (
              <EmptyState
                icon={UsersIcon}
                title={t("noTeamMembersTitle")}
                description={t("addUserVisibleDesc")}
              />
            ) : (
              <ul className="divide-y divide-border/60">
                {repo.members.map((member) => (
                  <li key={member.userId} className="py-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{memberName(member)}</p>
                        <p className="text-muted-foreground truncate text-sm">{member.email}</p>
                      </div>
                      {canEdit && (
                        <MemberRemoveButton
                          repoId={repo.id}
                          userId={member.userId}
                          onRemoved={load}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {canEdit && (
              <ProjectMemberAdder
                repoId={repo.id}
                currentMembers={repo.members}
                onAdd={async (userId) => {
                  await addRepoMember(repo.id, userId, crypto.randomUUID());
                  await load();
                }}
              />
            )}
          </SectionCard>
        </div>
        <SectionCard title={t("challenges")} bodyClassName="space-y-4">
          {repo.challenges.length === 0 ? (
            <EmptyState
              icon={TrophyIcon}
              title={t("noChallengesAssignedTitle")}
              description={t("addChallengeQueueDesc")}
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {repo.challenges.map((challenge) => (
                <li key={challenge.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="min-w-0 text-base font-medium text-balance">
                      {challengeTitleText(challenge.title)}
                    </h3>
                    <div className="flex items-center gap-2">
                      {challenge.status && challenge.reviewStatus === null && (
                        <span className="text-xs text-muted-foreground">
                          {t("challengeReviewNotStarted")}
                        </span>
                      )}
                      {challenge.status && challenge.reviewStatus !== null && (
                        <ReviewStatusBadge status={challenge.reviewStatus} score={challenge.nota} />
                      )}
                      {challenge.mandatory && (
                        <span className="text-xs text-muted-foreground">
                          {t("mandatoryChallengeLabel")}
                        </span>
                      )}
                      {canEdit && !challenge.mandatory && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await removeRepoChallenge(repo.id, challenge.id);
                              toast.success(t("challengeRemoved"), {
                                compactTitle: t("toastWithdrawChallenge"),
                              });
                              await load();
                            } catch (err) {
                              toast.error(
                                err instanceof ApiError
                                  ? err.message
                                  : t("couldNotRemoveChallenge"),
                                t("toastWithdrawChallenge"),
                              );
                            }
                          }}
                        >
                          {t("remove")}
                        </Button>
                      )}
                    </div>
                  </div>
                  {challenge.status ? (
                    <PresentationStatus {...challenge} />
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("plannedChallenge")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <ProjectChallengeAdder
              repoId={repo.id}
              challenges={availableChallenges}
              onAdd={async (challengeId) => {
                await addRepoChallenge(repo.id, challengeId, crypto.randomUUID());
                await load();
              }}
            />
          )}
        </SectionCard>
      </div>
    </PageLayout>
  );
}
