"use client";

// Project detail with hot-edit membership and challenge assignment (H20-H21).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  FolderGitIcon,
  TrophyIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { ReviewStatusBadge } from "@/components/common/review-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { ProjectDescription } from "@/components/projects/project-description";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  addRepoChallenge,
  addRepoMember,
  getRepoById,
  removeRepoChallenge,
  removeRepoPrize,
} from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import type { UserList } from "@/lib/types";
import { ProjectFormDialog } from "../project-form-dialog";
import {
  challengeTitleText,
  memberName,
  mergeStatusLabel,
  mergeStatusTone,
  type ProjectRepo,
  toProjectRepo,
  toUnifiedEntries,
} from "../shared";

type ChallengeOption = {
  id: number;
  title: Record<string, string> | string;
};

function manualMemberCount(repo: ProjectRepo): number {
  return repo.members.filter((member) => member.mergeStatus === "manual").length;
}

function _userLabel(user: UserList["users"][number]): string {
  const name = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return name ? `${name} · ${user.email}` : user.email;
}

import {
  DevpostParticipantActions,
  MemberRemoveButton,
  ProjectChallengeAdder,
  ProjectMemberAdder,
} from "./project-actions";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { t } = useLocale();
  const { can } = useSessionContext();
  const canRead = can(CAPABILITIES.PROJECTS_READ);
  const canEdit = can(CAPABILITIES.PROJECTS_EDIT);
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);
  const id = Number(params.id);
  const [repo, setRepo] = useState<ProjectRepo | null>(null);
  const [users, setUsers] = useState<UserList["users"]>([]);
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

      if (canEdit || canImport) {
        const [usersResult, challengeResult] = await Promise.allSettled([
          canImport
            ? api.get<UserList>("/api/users", { query: { limit: 200 } })
            : Promise.resolve(null),
          canEdit
            ? api.get<{ challenges: ChallengeOption[] }>("/api/challenges")
            : api.get<{ items: ChallengeOption[] }>("/api/public/challenges"),
        ]);
        if (usersResult.status === "fulfilled" && usersResult.value) {
          setUsers(usersResult.value.users);
        } else if (canImport) setUsers([]);
        if (challengeResult.status === "fulfilled") {
          setChallenges(
            "challenges" in challengeResult.value
              ? challengeResult.value.challenges
              : challengeResult.value.items,
          );
        } else {
          setChallenges([]);
        }
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadProject"));
      setRepo(null);
    } finally {
      setLoading(false);
    }
  }, [canEdit, canImport, canRead, id, t]);

  // Soft, in-place refresh instead of a hard reload when this project
  // changes elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    void load();
  }, [load, liveRefresh]);

  const challengeCount = repo?.challenges.length ?? 0;
  const queueChallengeIds = useMemo(
    () =>
      new Set(
        repo?.challenges
          .filter((challenge) => challenge.status !== null)
          .map((challenge) => challenge.id) ?? [],
      ),
    [repo],
  );
  const unifiedEntries = useMemo(() => (repo ? toUnifiedEntries(repo) : []), [repo]);
  const availableChallenges = useMemo(
    () => challenges.filter((challenge) => !queueChallengeIds.has(challenge.id)),
    [challenges, queueChallengeIds],
  );

  if (!canRead) {
    return <AccessDenied ask={t("projectAccessDeniedDesc")} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("colProject")}
          actions={
            <Button variant="outline" asChild>
              <Link href="/projects">
                <ArrowLeftIcon className="size-4" />
                {t("projects")}
              </Link>
            </Button>
          }
        />
        <EmptyState icon={FolderGitIcon} title={t("projectNotFoundTitle")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        // The parent crumb is the way back; a second "Projects" button next to
        // it said the same thing twice (issue #297).
        context={
          <Link href="/projects" className="hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeftIcon className="size-3" />
            {t("projects")}
          </Link>
        }
        title={repo.name}
        actions={
          /* H18: metadata edit (name, description, links). */
          canEdit ? (
            <ProjectFormDialog
              key={`${repo.id}-${repo.name}`}
              mode={{ kind: "edit", repo }}
              onSaved={load}
            />
          ) : undefined
        }
      />

      {repo.description && (
        <div className="max-w-prose">
          <ProjectDescription text={repo.description} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("teamMembers")} value={repo.members.length} />
        <StatCard label={t("manualAdds")} value={manualMemberCount(repo)} />
        <StatCard label={t("challenges")} value={challengeCount} />
        <StatCard label={t("unmappedPrizesLabel")} value={repo.unmappedPrizes.length} />
      </div>

      <SectionCard title={t("linksTitle")} icon={ExternalLinkIcon}>
        <div className="flex flex-wrap gap-2">
          {repo.devpost_url && (
            <Button variant="outline" asChild>
              <a href={repo.devpost_url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="size-4" />
                Devpost
              </a>
            </Button>
          )}
          {repo.demo_url && (
            <Button variant="outline" asChild>
              <a href={repo.demo_url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="size-4" />
                Demo
              </a>
            </Button>
          )}
          {repo.github_url && (
            <Button variant="outline" asChild>
              <a href={repo.github_url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="size-4" />
                Repository
              </a>
            </Button>
          )}
          {!repo.devpost_url && !repo.demo_url && !repo.github_url && (
            <p className="text-muted-foreground text-sm">{t("noLinksProject")}</p>
          )}
        </div>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title={t("teamSectionTitle")}
          description={t("teamSectionDesc")}
          icon={UsersIcon}
          bodyClassName="space-y-4"
        >
          {repo.members.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title={t("noTeamMembersTitle")}
              description={t("addUserVisibleDesc")}
            />
          ) : (
            <ul className="space-y-3">
              {repo.members.map((member) => (
                <li
                  key={`${member.userId ?? "devpost"}:${member.email}`}
                  className="rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{memberName(member)}</p>
                      <p className="text-muted-foreground truncate text-sm">{member.email}</p>
                      <p className="text-muted-foreground text-xs">
                        {member.mergeStatus === "manual"
                          ? t("addedManually")
                          : member.devpostUsername
                            ? `@${member.devpostUsername}`
                            : mergeStatusLabel(member.mergeStatus)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={mergeStatusTone(member.mergeStatus)}>
                        {mergeStatusLabel(member.mergeStatus)}
                      </StatusBadge>
                      {canEdit && member.userId !== null && (
                        <MemberRemoveButton
                          repoId={repo.id}
                          userId={member.userId}
                          onRemoved={load}
                        />
                      )}
                      {member.userId === null &&
                        member.email !== null &&
                        (canEdit || canImport) && (
                          <DevpostParticipantActions
                            repoId={repo.id}
                            email={member.email}
                            users={users}
                            canDelete={canEdit}
                            canLink={canImport}
                            onChanged={load}
                          />
                        )}
                    </div>
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

        <SectionCard title={t("challenges")} icon={TrophyIcon} bodyClassName="space-y-4">
          {unifiedEntries.length === 0 ? (
            <EmptyState
              icon={TrophyIcon}
              title={t("noChallengesAssignedTitle")}
              description={t("addChallengeQueueDesc")}
            />
          ) : (
            <ul className="space-y-3">
              {unifiedEntries.map((entry) =>
                entry.kind === "challenge" ? (
                  <li key={`challenge-${entry.challenge.id}`} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {challengeTitleText(entry.challenge.title)}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {entry.challenge.status
                            ? entry.challenge.assignedRoomName
                              ? t("roomColon", { room: entry.challenge.assignedRoomName })
                              : t("noRoomAssigned")
                            : entry.challenge.mappedPrizes.length === 1
                              ? t("linkedByPrizeOne", {
                                  count: entry.challenge.mappedPrizes.length,
                                })
                              : t("linkedByPrizeOther", {
                                  count: entry.challenge.mappedPrizes.length,
                                })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {entry.challenge.status ? (
                          <QueueStatusBadge status={entry.challenge.status} />
                        ) : (
                          <StatusBadge tone="info">{t("prizeBadge")}</StatusBadge>
                        )}
                        {entry.challenge.status && (
                          <ReviewStatusBadge
                            status={entry.challenge.reviewStatus}
                            score={entry.challenge.nota}
                          />
                        )}
                        {canEdit && entry.challenge.status && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                await removeRepoChallenge(repo.id, entry.challenge.id);
                                toast.success(t("challengeRemoved"));
                                await load();
                              } catch (err) {
                                toast.error(
                                  err instanceof ApiError
                                    ? err.message
                                    : t("couldNotRemoveChallenge"),
                                );
                              }
                            }}
                          >
                            {t("remove")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ) : (
                  <li key={`prize-${entry.prize}`} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{entry.prize}</p>
                        <p className="text-muted-foreground text-xs">{t("noLinkedChallenge")}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tone="warning">{t("unlinkedBadge")}</StatusBadge>
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                await removeRepoPrize(repo.id, entry.prize);
                                toast.success(t("prizeRemoved"));
                                await load();
                              } catch (err) {
                                toast.error(
                                  err instanceof ApiError ? err.message : t("couldNotRemovePrize"),
                                );
                              }
                            }}
                          >
                            {t("remove")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ),
              )}
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
    </div>
  );
}
