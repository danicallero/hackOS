"use client";

// Project detail with hot-edit membership and challenge assignment (H20-H21).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  FolderGitIcon,
  LinkIcon,
  LockIcon,
  SearchIcon,
  Trash2Icon,
  TrophyIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
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
import { ApiError, api } from "@/lib/api";
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
import {
  challengeTitleText,
  memberName,
  mergeStatusLabel,
  mergeStatusTone,
  type ProjectRepo,
  toProjectRepo,
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
  const { can } = useSessionContext();
  const canRead = can(CAPABILITIES.PROJECTS_READ);
  const canEdit = can(CAPABILITIES.PROJECTS_EDIT);
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);
  const id = Number(params.id);
  const [repo, setRepo] = useState<ProjectRepo | null>(null);
  const [users, setUsers] = useState<UserList["users"]>([]);
  const [challenges, setChallenges] = useState<ChallengeOption[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!canRead || !Number.isFinite(id)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const repoRes = await getRepoById(id);
      setRepo(toProjectRepo(repoRes));

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
      toast.error(err instanceof ApiError ? err.message : "Could not load project.");
      setRepo(null);
    } finally {
      setLoading(false);
    }
  }, [canEdit, canImport, canRead, id]);

  useEffect(() => {
    void load();
  }, [load]);

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
  const prizeChallengeTitles = useMemo(() => {
    const titles = new Map<string, string[]>();
    for (const challenge of repo?.challenges ?? []) {
      for (const prize of challenge.mappedPrizes ?? []) {
        const arr = titles.get(prize) ?? [];
        arr.push(challengeTitleText(challenge.title));
        titles.set(prize, arr);
      }
    }
    return titles;
  }, [repo]);
  const availableChallenges = useMemo(
    () => challenges.filter((challenge) => !queueChallengeIds.has(challenge.id)),
    [challenges, queueChallengeIds],
  );

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader title="Project" />
        <EmptyState
          icon={LockIcon}
          title="You can't access projects"
          description="Project access requires the projects:read capability."
        />
      </div>
    );
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
          title="Project"
          actions={
            <Button variant="outline" asChild>
              <Link href="/projects">
                <ArrowLeftIcon className="size-4" />
                Projects
              </Link>
            </Button>
          }
        />
        <EmptyState icon={FolderGitIcon} title="Project not found" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={repo.name}
        description="Current team membership and queue assignments for this project."
        actions={
          <Button variant="outline" asChild>
            <Link href="/projects">
              <ArrowLeftIcon className="size-4" />
              Projects
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Team members" value={repo.members.length} />
        <StatCard label="Manual adds" value={manualMemberCount(repo)} />
        <StatCard label="Challenges" value={challengeCount} />
        <StatCard label="Prizes" value={repo.prizes.length} />
      </div>

      <SectionCard title="Links" description="External submission URLs." icon={ExternalLinkIcon}>
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
            <p className="text-muted-foreground text-sm">No links on this project.</p>
          )}
        </div>
      </SectionCard>

      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Team"
          description="Current team membership. Added users are live in the queue surface immediately."
          icon={UsersIcon}
          bodyClassName="space-y-4"
        >
          {repo.members.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No team members"
              description="Add a user to make this project visible in participant and queue views."
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
                          ? "Added manually"
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
                      {member.userId === null && (canEdit || canImport) && (
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

        <SectionCard
          title="Challenges"
          description="Current challenge participation for this project."
          icon={TrophyIcon}
          bodyClassName="space-y-4"
        >
          {repo.challenges.length === 0 ? (
            <EmptyState
              icon={TrophyIcon}
              title="No challenges assigned"
              description="Add the project to a challenge to place it in the queue."
            />
          ) : (
            <ul className="space-y-3">
              {repo.challenges.map((challenge) => (
                <li key={challenge.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{challengeTitleText(challenge.title)}</p>
                      <p className="text-muted-foreground text-xs">
                        {challenge.status
                          ? challenge.assignedRoomName
                            ? `Room: ${challenge.assignedRoomName}`
                            : "No room assigned"
                          : `Linked by ${challenge.mappedPrizes.length} prize${
                              challenge.mappedPrizes.length === 1 ? "" : "s"
                            }`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {challenge.status ? (
                        <QueueStatusBadge status={challenge.status} />
                      ) : (
                        <StatusBadge tone="info">Prize</StatusBadge>
                      )}
                      {canEdit && challenge.status && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await removeRepoChallenge(repo.id, challenge.id);
                              toast.success("Challenge removed.");
                              await load();
                            } catch (err) {
                              toast.error(
                                err instanceof ApiError
                                  ? err.message
                                  : "Could not remove challenge.",
                              );
                            }
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
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

        <SectionCard
          title="Prizes"
          description="Imported Devpost prize participation for this project."
          icon={TrophyIcon}
          bodyClassName="space-y-4"
        >
          {repo.prizes.length === 0 ? (
            <EmptyState
              icon={TrophyIcon}
              title="No prizes imported"
              description="Prizes appear here after a Devpost import."
            />
          ) : (
            <ul className="space-y-3">
              {repo.prizes.map((prize) => {
                const linkedChallenges = prizeChallengeTitles.get(prize) ?? [];
                return (
                  <li key={prize} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{prize}</p>
                        <p className="text-muted-foreground text-xs">
                          {linkedChallenges.length > 0
                            ? `Linked to ${linkedChallenges.join(", ")}`
                            : "No linked challenge"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {linkedChallenges.length === 0 && (
                          <StatusBadge tone="warning">Unlinked</StatusBadge>
                        )}
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                              try {
                                await removeRepoPrize(repo.id, prize);
                                toast.success("Prize removed.");
                                await load();
                              } catch (err) {
                                toast.error(
                                  err instanceof ApiError ? err.message : "Could not remove prize.",
                                );
                              }
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
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
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await removeRepoMember(repoId, userId);
          toast.success("Member removed.");
          await onRemoved();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : "Could not remove member.");
        }
      }}
    >
      Remove
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
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState<"delete" | "link" | null>(null);
  const dialogId = `devpost-link-${repoId}-${email}`;

  async function deleteParticipant() {
    setBusy("delete");
    try {
      await removeDevpostParticipant(repoId, email);
      toast.success("Participant deleted.");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete participant.");
    } finally {
      setBusy(null);
    }
  }

  async function linkParticipant() {
    if (!selectedUserId) return;
    setBusy("link");
    try {
      await linkSecondaryEmail(repoId, email, Number(selectedUserId));
      toast.success("Verification email sent to the linked address.");
      setOpen(false);
      setSelectedUserId("");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not link participant to user.");
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
            Link Participant to User
          </Button>
          {open && (
            <div id={dialogId} className="grid w-full gap-2 sm:grid-cols-[minmax(220px,1fr)_auto]">
              <Label htmlFor={`${dialogId}-user`} className="sr-only">
                User for {email}
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id={`${dialogId}-user`}>
                  <SelectValue placeholder="Select user" />
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
                Link
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
          Delete
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
          toast.error(err instanceof ApiError ? err.message : "Could not search users.");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const memberUserIds = useMemo(
    () =>
      new Set(currentMembers.flatMap((member) => (member.userId === null ? [] : [member.userId]))),
    [currentMembers],
  );
  const availableUsers = users.filter((user) => !memberUserIds.has(user.id));
  const selectedUserId = selectedUser?.id ?? null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor={`member-${repoId}`}>Add member</Label>
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
              placeholder="Search users by name or email..."
              className="pl-9"
            />
          </div>
          {query.trim().length >= 2 && (
            <div className="max-h-56 overflow-auto rounded-md border">
              {searching ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">Searching...</p>
              ) : availableUsers.length === 0 ? (
                <p className="text-muted-foreground px-3 py-2 text-sm">No matching users.</p>
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
                        {user.confirmedSpot ? "confirmed" : user.role}
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
              toast.success("Member added.");
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Could not add member.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Add
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
  const [challengeId, setChallengeId] = useState(challenges[0] ? String(challenges[0].id) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!challengeId && challenges[0]) setChallengeId(String(challenges[0].id));
  }, [challengeId, challenges]);

  if (challenges.length === 0) {
    return <p className="text-muted-foreground text-sm">No challenges available to add.</p>;
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor={`challenge-${repoId}`}>Add challenge</Label>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Select value={challengeId} onValueChange={setChallengeId}>
          <SelectTrigger id={`challenge-${repoId}`}>
            <SelectValue placeholder="Select challenge" />
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
              toast.success("Challenge added.");
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Could not add challenge.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
