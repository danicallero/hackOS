"use client";

// Resolve unmatched Devpost participants and map prizes to challenges (H17).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  LinkIcon,
  MailIcon,
  TrophyIcon,
  UserPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
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
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  type DevpostPrize,
  linkParticipant,
  linkSecondaryEmail,
  listDevpostPrizes,
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
  const { t } = useLocale();
  const { can } = useSessionContext();
  const canImport = can(CAPABILITIES.PROJECTS_IMPORT);
  const [rows, setRows] = useState<UnmatchedRow[]>([]);
  const [prizes, setPrizes] = useState<DevpostPrize[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [challenges, setChallenges] = useState<PublicChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Record<string, string>>({});
  const [selectedPrizeChallenges, setSelectedPrizeChallenges] = useState<Record<string, string>>(
    {},
  );
  const [prizeName, setPrizeName] = useState("");
  const [challengeId, setChallengeId] = useState("");

  const unmappedPrizes = prizes.filter((p) => p.mappedChallengeId === null);

  const load = useCallback(async () => {
    if (!canImport) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [unmatched, devpostPrizes, publicChallenges] = await Promise.all([
        listUnmatched(),
        listDevpostPrizes(),
        api.get<{ items: PublicChallenge[] }>("/api/public/challenges"),
      ]);
      setRows(unmatched.participants.map(toUnmatchedRow));
      setPrizes(devpostPrizes.prizes);
      setChallenges(publicChallenges.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadUnmatched"));
    } finally {
      setLoading(false);
    }
  }, [canImport, t]);

  const searchUsers = useCallback(async () => {
    try {
      const res = await api.get<UserList>("/api/users", {
        query: { q: userQuery.trim() || undefined, limit: 25 },
      });
      setUsers(res.users);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSearchUsers"));
    }
  }, [userQuery, t]);

  // Soft, in-place refresh instead of a hard reload when a project/repo
  // changes elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    void load();
  }, [load, liveRefresh]);

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
        toast.error(err instanceof ApiError ? err.message : t("actionFailedGeneric"));
      } finally {
        setBusy(null);
      }
    },
    [load, t],
  );

  if (!canImport) {
    return <AccessDenied ask={t("resolveImportsDeniedDesc")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("resolveImports")}
        actions={
          <Button variant="outline" asChild>
            <Link href="/projects">
              <ArrowLeftIcon className="size-4" />
              {t("projects")}
            </Link>
          </Button>
        }
      />

      {!loading && (
        <SectionCard title={t("unresolvedConflictsTitle")}>
          {rows.length === 0 && unmappedPrizes.length === 0 ? (
            <EmptyState
              icon={CheckCircle2Icon}
              title={t("noConflictsTitle")}
              description={t("noConflictsDesc")}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label={t("colMembersUnmatched")} value={rows.length} />
              <StatCard label={t("colPrizesUnmapped")} value={unmappedPrizes.length} />
            </div>
          )}
        </SectionCard>
      )}

      {unmappedPrizes.length > 0 && (
        <SectionCard title={t("unmappedPrizesTitle")} description={t("unmappedPrizesDesc")}>
          <ul className="space-y-3">
            {unmappedPrizes.map((prize) => {
              const key = `prize:${prize.name}`;
              const selected = selectedPrizeChallenges[key] ?? "";
              return (
                <li key={prize.name} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{prize.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {prize.repoCount === 1
                          ? t("projectCountOne", { count: prize.repoCount })
                          : t("projectCountOther", { count: prize.repoCount })}
                      </p>
                    </div>
                    <StatusBadge tone="warning">{t("unmappedBadge")}</StatusBadge>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="space-y-2">
                      <Label htmlFor={`prize-challenge-${key}`}>{t("challengeLabel")}</Label>
                      <Select
                        value={selected}
                        onValueChange={(value) =>
                          setSelectedPrizeChallenges((current) => ({ ...current, [key]: value }))
                        }
                      >
                        <SelectTrigger id={`prize-challenge-${key}`} className="w-full">
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
                    </div>
                    <Button
                      variant="outline"
                      disabled={!selected || busy === key}
                      onClick={() =>
                        mutate(key, () => mapPrize(prize.name, Number(selected)), t("prizeMapped"))
                      }
                    >
                      <LinkIcon className="size-4" />
                      {t("mapPrize")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      <SectionCard
        title={t("prizeMappingTitle")}
        description={t("prizeMappingDesc")}
        icon={TrophyIcon}
        footer={
          <Button
            disabled={!prizeName.trim() || !challengeId || busy === "map-prize"}
            onClick={() =>
              mutate(
                "map-prize",
                () => mapPrize(prizeName.trim(), Number(challengeId)),
                t("prizeMapped"),
              )
            }
          >
            <LinkIcon className="size-4" />
            {t("mapPrize")}
          </Button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="prize-name">{t("prizeNameLabel")}</Label>
            <Input
              id="prize-name"
              value={prizeName}
              onChange={(event) => setPrizeName(event.target.value)}
              placeholder={t("exactDevpostPrizeNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="challenge-map">{t("challengeLabel")}</Label>
            <Select value={challengeId} onValueChange={setChallengeId}>
              <SelectTrigger id="challenge-map" className="w-full">
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
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("unmatchedParticipantsTitle")} icon={UserPlusIcon}>
        <div className="mb-4 space-y-2">
          <Label htmlFor="user-search">{t("userSearchLabel")}</Label>
          <Input
            id="user-search"
            value={userQuery}
            onChange={(event) => setUserQuery(event.target.value)}
            placeholder={t("searchUsersNameEmail")}
          />
        </div>

        {loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={UserPlusIcon}
            title={t("noUnmatchedParticipantsTitle")}
            description={t("allImportedLinkedDesc")}
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
                        {t("repoNameBatchInline", { repo: row.repo_name, batch: row.import_batch })}
                      </p>
                    </div>
                    {row.claim_email_sent_at ? (
                      <StatusBadge tone="info">{t("claimEmailSent")}</StatusBadge>
                    ) : (
                      <StatusBadge tone="warning">{t("unmatchedBadge")}</StatusBadge>
                    )}
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end">
                    <div className="space-y-2">
                      <Label htmlFor={`user-${key}`}>{t("linkToUserLabel")}</Label>
                      <Select
                        value={selectedUserId}
                        onValueChange={(value) =>
                          setSelectedUsers((current) => ({ ...current, [key]: value }))
                        }
                      >
                        <SelectTrigger id={`user-${key}`} className="w-full">
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
                    </div>
                    <Button
                      variant="outline"
                      disabled={!selectedUserId || busy === key}
                      onClick={() =>
                        mutate(
                          key,
                          () => linkParticipant(row.repo_id, row.email, Number(selectedUserId)),
                          t("participantLinked"),
                        )
                      }
                    >
                      <LinkIcon className="size-4" />
                      {t("link")}
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
                          t("verificationEmailSentLinked"),
                        )
                      }
                    >
                      <UserPlusIcon className="size-4" />
                      {t("linkParticipantToUser")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy === `${key}:claim`}
                      onClick={() =>
                        mutate(
                          `${key}:claim`,
                          () => sendClaimEmail(row.repo_id, row.email),
                          t("claimEmailQueued"),
                        )
                      }
                    >
                      <MailIcon className="size-4" />
                      {t("claimEmail")}
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
