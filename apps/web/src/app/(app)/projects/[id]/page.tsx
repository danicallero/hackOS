"use client";

// Project detail with hot-edit membership and challenge assignment (H20-H21).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  FolderGitIcon,
  LinkIcon,
  SearchIcon,
  Trash2Icon,
  TrophyIcon,
  UserPlusIcon,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  addRepoChallenge,
  addRepoMember,
  getRepoById,
  linkSecondaryEmail,
  removeDevpostParticipant,
  removeRepoChallenge,
  removeRepoMember,
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

function userLabel(user: UserList["users"][number]): string {
  const name = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return name ? `${name} · ${user.email}` : user.email;
}

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

function MemberRemoveButton({
  repoId,
  userId,
  onRemoved,
}: {
  repoId: number;
  userId: number;
  onRemoved: () => Promise<void>;
}) {
  const { t } = useLocale();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await removeRepoMember(repoId, userId);
          toast.success(t("memberRemoved"));
          await onRemoved();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveMember"));
        }
      }}
    >
      {t("remove")}
    </Button>
  );
}

function DevpostParticipantActions({
  repoId,
  email,
  users,
  canDelete,
  canLink,
  onChanged,
}: {
  repoId: number;
  email: string;
  users: UserList["users"];
  canDelete: boolean;
  canLink: boolean;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState<"delete" | "link" | null>(null);
  const dialogId = `devpost-link-${repoId}-${email}`;

  async function deleteParticipant() {
    setBusy("delete");
    try {
      await removeDevpostParticipant(repoId, email);
      toast.success(t("participantDeleted"));
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteParticipant"));
    } finally {
      setBusy(null);
    }
  }

  async function linkParticipant() {
    if (!selectedUserId) return;
    setBusy("link");
    try {
      await linkSecondaryEmail(repoId, email, Number(selectedUserId));
      toast.success(t("verificationEmailSentLinked"));
      setOpen(false);
      setSelectedUserId("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLinkParticipant"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canLink && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-controls={dialogId}
            onClick={() => setOpen((current) => !current)}
          >
            <UserPlusIcon className="size-4" />
            {t("linkParticipantToUser")}
          </Button>
          {open && (
            <div id={dialogId} className="grid w-full gap-2 sm:grid-cols-[minmax(220px,1fr)_auto]">
              <Label htmlFor={`${dialogId}-user`} className="sr-only">
                {t("userForEmail", { email })}
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id={`${dialogId}-user`}>
                  <SelectValue placeholder={t("selectUserPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={String(user.id)}>
                      {userLabel(user)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                disabled={!selectedUserId || busy === "link"}
                onClick={linkParticipant}
              >
                <LinkIcon className="size-4" />
                {t("link")}
              </Button>
            </div>
          )}
        </>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy === "delete"}
          onClick={deleteParticipant}
        >
          <Trash2Icon className="size-4" />
          {t("deleteAction")}
        </Button>
      )}
    </div>
  );
}

function ProjectMemberAdder({
  repoId,
  currentMembers,
  onAdd,
}: {
  repoId: number;
  currentMembers: ProjectRepo["members"];
  onAdd: (userId: number) => Promise<void>;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserList["users"]>([]);
  const [selectedUser, setSelectedUser] = useState<UserList["users"][number] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setUsers([]);
      setSelectedUser(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get<UserList>("/api/users", { query: { q: trimmed, limit: 10 } });
        if (!cancelled) setUsers(res.users);
      } catch (err) {
        if (!cancelled) {
          setUsers([]);
          toast.error(err instanceof ApiError ? err.message : t("couldNotSearchUsers"));
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, t]);

  const memberUserIds = useMemo(
    () =>
      new Set(currentMembers.flatMap((member) => (member.userId === null ? [] : [member.userId]))),
    [currentMembers],
  );
  const availableUsers = users.filter((user) => !memberUserIds.has(user.id));
  const selectedUserId = selectedUser?.id ?? null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor={`member-${repoId}`}>{t("addMemberLabel")}</Label>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              id={`member-${repoId}`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedUser(null);
              }}
              placeholder={t("searchUsersNameEmailPlaceholder")}
              className="pl-9"
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="max-h-56 overflow-auto rounded-md border">
              {searching ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">{t("searchingEllipsis")}</p>
              ) : availableUsers.length === 0 ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">
                  {t("noMatchingUsersPeriod")}
                </p>
              ) : (
                availableUsers.map((user) => {
                  const selected = selectedUserId === user.id;
                  const name = [user.name, user.surname].filter(Boolean).join(" ").trim();
                  return (
                    <button
                      key={user.id}
                      type="button"
                      className={`hover:bg-muted flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                        selected ? "bg-muted" : ""
                      }`}
                      onClick={() => setSelectedUser(user)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{name || user.email}</span>
                        {name && (
                          <span className="text-muted-foreground block truncate text-xs">
                            {user.email}
                          </span>
                        )}
                      </span>
                      <StatusBadge tone={user.confirmedSpot ? "success" : "neutral"}>
                        {user.confirmedSpot ? t("confirmedStatus") : user.role}
                      </StatusBadge>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
        <Button
          disabled={busy || selectedUserId === null}
          onClick={async () => {
            setBusy(true);
            try {
              if (selectedUserId === null) return;
              await onAdd(selectedUserId);
              setQuery("");
              setSelectedUser(null);
              setUsers([]);
              toast.success(t("memberAdded"));
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : t("couldNotAddMember"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("addAction")}
        </Button>
      </div>
    </div>
  );
}

function ProjectChallengeAdder({
  repoId,
  challenges,
  onAdd,
}: {
  repoId: number;
  challenges: ChallengeOption[];
  onAdd: (challengeId: number) => Promise<void>;
}) {
  const { t } = useLocale();
  const [challengeId, setChallengeId] = useState(challenges[0] ? String(challenges[0].id) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!challengeId && challenges[0]) setChallengeId(String(challenges[0].id));
  }, [challengeId, challenges]);

  if (challenges.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("noChallengesAvailableAdd")}</p>;
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor={`challenge-${repoId}`}>{t("addChallengeLabel")}</Label>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Select value={challengeId} onValueChange={setChallengeId}>
          <SelectTrigger id={`challenge-${repoId}`}>
            <SelectValue placeholder={t("selectChallengePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {challenges.map((challenge) => (
              <SelectItem key={challenge.id} value={String(challenge.id)}>
                {challengeTitleText(challenge.title)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={busy || !challengeId}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd(Number(challengeId));
              toast.success(t("challengeAddedMsg"));
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : t("couldNotAddChallenge"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("addAction")}
        </Button>
      </div>
    </div>
  );
}
