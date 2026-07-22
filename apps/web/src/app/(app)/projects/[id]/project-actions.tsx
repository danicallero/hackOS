"use client";
import { LinkIcon, SearchIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { useLocale } from "@/lib/i18n";
import { linkSecondaryEmail, removeDevpostParticipant, removeRepoMember } from "@/lib/projects";
import type { UserList } from "@/lib/types";
import { challengeTitleText, type ProjectRepo } from "../shared";

type ChallengeOption = {
  id: number;
  title: Record<string, string> | string;
};

function _manualMemberCount(repo: ProjectRepo): number {
  return repo.members.filter((member) => member.mergeStatus === "manual").length;
}

function userLabel(user: UserList["users"][number]): string {
  const name = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return name ? `${name} · ${user.email}` : user.email;
}

export function MemberRemoveButton({
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

export function DevpostParticipantActions({
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

export function ProjectMemberAdder({
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

export function ProjectChallengeAdder({
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
