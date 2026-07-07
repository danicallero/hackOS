"use client";

// Project detail with hot-edit membership and challenge assignment (H20-H21).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  FolderGitIcon,
  LinkIcon,
  LockIcon,
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
          api.get<UserList>("/api/users", { query: { limit: 200 } }),
          (async () => {
            try {
              return {
                challenges: (await api.get<{ challenges: ChallengeOption[] }>("/api/challenges"))
                  .challenges,
              };
            } catch {
              return {
                challenges: (await api.get<{ items: ChallengeOption[] }>("/api/public/challenges"))
                  .items,
              };
            }
          })(),
        ]);
        if (usersResult.status === "fulfilled") setUsers(usersResult.value.users);
        else setUsers([]);
        if (challengeResult.status === "fulfilled") setChallenges(challengeResult.value.challenges);
        else setChallenges([]);
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

  const activeChallenges = useMemo(
    () =>
      repo?.challenges.filter((challenge) =>
        ["waiting", "called", "in_room", "presenting"].includes(challenge.status),
      ) ?? [],
    [repo],
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
        <StatCard label="Challenges" value={activeChallenges.length} />
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
                <li key={member.email} className="rounded-md border p-3">
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
                      {(canEdit || canImport) && (
                        <ProjectMemberActions
                          repoId={repo.id}
                          member={member}
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
              users={users}
              onAdd={async (userId) => {
                await addRepoMember(repo.id, userId, crypto.randomUUID());
                await load();
              }}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Challenges"
          description="Current queue membership for this project."
          icon={TrophyIcon}
          bodyClassName="space-y-4"
        >
          {activeChallenges.length === 0 ? (
            <EmptyState
              icon={TrophyIcon}
              title="No challenges assigned"
              description="Add the project to a challenge to place it in the queue."
            />
          ) : (
            <ul className="space-y-3">
              {activeChallenges.map((challenge) => (
                <li key={challenge.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{challengeTitleText(challenge.title)}</p>
                      <p className="text-muted-foreground text-xs">
                        {challenge.assignedRoomName
                          ? `Room: ${challenge.assignedRoomName}`
                          : "No room assigned"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <QueueStatusBadge status={challenge.status} />
                      {canEdit && (
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
              challenges={challenges}
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

function ProjectMemberActions({
  repoId,
  member,
  users,
  canDelete,
  canLink,
  onChanged,
}: {
  repoId: number;
  member: ProjectRepo["members"][number];
  users: UserList["users"];
  canDelete: boolean;
  canLink: boolean;
  onChanged: () => Promise<void>;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState<"delete" | "link" | null>(null);
  const participantKey = `${repoId}-${member.email}`;
  const canLinkParticipant = canLink && member.mergeStatus === "unmatched";

  async function deleteParticipant() {
    setBusy("delete");
    try {
      if (member.mergeStatus === "manual" && member.userId !== null) {
        await removeRepoMember(repoId, member.userId);
      } else {
        await removeDevpostParticipant(repoId, member.email);
      }
      toast.success("Participant deleted.");
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete participant.");
    } finally {
      setBusy(null);
    }
  }

  async function linkParticipantToUser() {
    if (!selectedUserId) return;
    setBusy("link");
    try {
      await linkSecondaryEmail(repoId, member.email, Number(selectedUserId));
      toast.success("Verification email sent to the linked address.");
      setLinkOpen(false);
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
      {canLinkParticipant && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={linkOpen}
            aria-controls={`link-participant-${participantKey}`}
            onClick={() => setLinkOpen((current) => !current)}
          >
            <UserPlusIcon className="size-4" />
            Link Participant to User
          </Button>
          {linkOpen && (
            <div
              id={`link-participant-${participantKey}`}
              className="grid w-full gap-2 sm:grid-cols-[minmax(220px,1fr)_auto]"
            >
              <Label htmlFor={`link-user-${participantKey}`} className="sr-only">
                User for {member.email}
              </Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger id={`link-user-${participantKey}`}>
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
                onClick={linkParticipantToUser}
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
  users,
  onAdd,
}: {
  repoId: number;
  users: UserList["users"];
  onAdd: (userId: number) => Promise<void>;
}) {
  const [userId, setUserId] = useState(users[0] ? String(users[0].id) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId && users[0]) setUserId(String(users[0].id));
  }, [userId, users]);

  if (users.length === 0) {
    return <p className="text-muted-foreground text-sm">No users available to add.</p>;
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor={`member-${repoId}`}>Add member</Label>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger id={`member-${repoId}`}>
            <SelectValue placeholder="Select user" />
          </SelectTrigger>
          <SelectContent>
            {users.map((user) => (
              <SelectItem key={user.id} value={String(user.id)}>
                {user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={busy || !userId}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd(Number(userId));
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
