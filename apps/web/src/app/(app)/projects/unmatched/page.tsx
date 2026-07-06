"use client";

// Resolve unmatched Devpost participants and map prizes to challenges (H17).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ArrowLeftIcon,
  LinkIcon,
  LockIcon,
  MailIcon,
  TrophyIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
  linkParticipant,
  linkSecondaryEmail,
  listUnmatched,
  mapPrize,
  sendClaimEmail,
} from "@/lib/projects";
import { useSessionContext } from "@/lib/session";
import type { UserList } from "@/lib/types";
import { challengeTitleText, memberName, toUnmatchedRow, type UnmatchedRow } from "../shared";

interface PublicChallenge {
  id: number;
  title: Record<string, string> | string;
}

interface UserOption {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
}

function userLabel(user: UserOption): string {
  const name = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return name ? `${name} · ${user.email}` : user.email;
}

export default function UnmatchedProjectsPage() {
  const { can } = useSessionContext();
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [challenges, setChallenges] = useState<PublicChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Record<string, string>>({});
  const [prizeName, setPrizeName] = useState("");
  const [challengeId, setChallengeId] = useState("");

  const load = useCallback(async () => {
    if (!canImport) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [unmatched, publicChallenges] = await Promise.all([
        listUnmatched(),
        api.get<{ items: PublicChallenge[] }>("/api/public/challenges"),
      ]);
      setRows(unmatched.participants.map(toUnmatchedRow));
      setChallenges(publicChallenges.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load unmatched participants.");
    } finally {
      setLoading(false);
    }
  }, [canImport]);

  const searchUsers = useCallback(async () => {
    try {
      const res = await api.get<UserList>("/api/users", {
        query: { q: userQuery.trim() || undefined, limit: 25 },
      });
      setUsers(res.users);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not search users.");
    }
  }, [userQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canImport) return;
    const handle = setTimeout(() => void searchUsers(), 250);
    return () => clearTimeout(handle);
  }, [canImport, searchUsers]);

  const mutate = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string) => {
      setBusy(key);
      try {
        await action();
        toast.success(success);
        await load();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Action failed.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  if (!canImport) {
    return (
      <div className="space-y-6">
        <PageHeader title="Resolve unmatched" />
        <EmptyState
          icon={LockIcon}
          title="You can't resolve imports"
          description="Resolving Devpost imports requires the projects:import capability."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resolve unmatched"
        description="Link imported Devpost participants to hackOS users or send account-claim emails."
        actions={
          <Button variant="outline" asChild>
            <Link href="/projects">
              <ArrowLeftIcon className="size-4" />
              Projects
            </Link>
          </Button>
        }
      />

      <SectionCard
        title="Prize mapping"
        description="Map a Devpost prize/tag to a hackOS challenge so imported projects appear in challenge views."
        icon={TrophyIcon}
        footer={
          <Button
            disabled={!prizeName.trim() || !challengeId || busy === "map-prize"}
            onClick={() =>
              mutate(
                "map-prize",
                () => mapPrize(prizeName.trim(), Number(challengeId)),
                "Prize mapped to challenge.",
              )
            }
          >
            <LinkIcon className="size-4" />
            Map prize
          </Button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="prize-name">Prize name</Label>
            <Input
              id="prize-name"
              value={prizeName}
              onChange={(event) => setPrizeName(event.target.value)}
              placeholder="Exact Devpost prize name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="challenge-map">Challenge</Label>
            <Select value={challengeId} onValueChange={setChallengeId}>
              <SelectTrigger id="challenge-map" className="w-full">
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
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Unmatched participants"
        description="Participants whose Devpost email did not match a hackOS account."
        icon={UserPlusIcon}
      >
        <div className="mb-4 space-y-2">
          <Label htmlFor="user-search">User search</Label>
          <Input
            id="user-search"
            value={userQuery}
            onChange={(event) => setUserQuery(event.target.value)}
            placeholder="Search users by name or email"
          />
        </div>

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={UserPlusIcon}
            title="No unmatched participants"
            description="All imported Devpost participants are linked to hackOS accounts."
          />
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const key = `${row.repo_id}:${row.email}`;
              const selectedUserId = selectedUsers[key] ?? "";
              return (
                <li key={key} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{memberName(row)}</p>
                      <p className="text-muted-foreground truncate text-sm">{row.email}</p>
                      <p className="text-muted-foreground text-xs">
                        {row.repo_name} · batch {row.import_batch}
                      </p>
                    </div>
                    {row.claim_email_sent_at ? (
                      <StatusBadge tone="info">Claim email sent</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">Unmatched</StatusBadge>
                    )}
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end">
                    <div className="space-y-2">
                      <Label htmlFor={`user-${key}`}>Link to user</Label>
                      <Select
                        value={selectedUserId}
                        onValueChange={(value) =>
                          setSelectedUsers((current) => ({ ...current, [key]: value }))
                        }
                      >
                        <SelectTrigger id={`user-${key}`} className="w-full">
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
                    </div>
                    <Button
                      variant="outline"
                      disabled={!selectedUserId || busy === key}
                      onClick={() =>
                        mutate(
                          key,
                          () => linkParticipant(row.repo_id, row.email, Number(selectedUserId)),
                          "Participant linked.",
                        )
                      }
                    >
                      <LinkIcon className="size-4" />
                      Link
                    </Button>
                    {/* H6: link by adding this email as the account's secondary and
                        triggering the platform's secondary-email verification. */}
                    <Button
                      variant="outline"
                      disabled={!selectedUserId || busy === `${key}:secondary`}
                      onClick={() =>
                        mutate(
                          `${key}:secondary`,
                          () => linkSecondaryEmail(row.repo_id, row.email, Number(selectedUserId)),
                          "Verification email sent to the linked address.",
                        )
                      }
                    >
                      <UserPlusIcon className="size-4" />
                      Link to hackOS user
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy === `${key}:claim`}
                      onClick={() =>
                        mutate(
                          `${key}:claim`,
                          () => sendClaimEmail(row.repo_id, row.email),
                          "Claim email queued.",
                        )
                      }
                    >
                      <MailIcon className="size-4" />
                      Claim email
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
