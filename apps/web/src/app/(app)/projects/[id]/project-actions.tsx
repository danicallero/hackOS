"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
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
import { useLocale } from "@/lib/i18n";
import { removeRepoMember } from "@/lib/projects";
import { toast } from "@/lib/toast";
import { type ChallengeOption, challengeTitleText, type ProjectRepo } from "../shared";

const MEMBER_SEARCH_LIMIT = 20;

async function searchMemberCandidates(q: string) {
  return (
    await api.get<{ users: UserOption[] }>("/api/projects/member-candidates", {
      query: { q, limit: MEMBER_SEARCH_LIMIT },
    })
  ).users;
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
  const [busy, setBusy] = useState(false);
  return (
    <AlertModal
      title={t("removeProjectMemberTitle")}
      description={t("removeProjectMemberDesc")}
      cancelLabel={t("cancel")}
      confirmLabel={t("remove")}
      destructive
      pending={busy}
      trigger={
        <Button variant="outline" size="sm">
          {t("remove")}
        </Button>
      }
      onConfirm={async () => {
        setBusy(true);
        try {
          await removeRepoMember(repoId, userId);
          toast.success(t("memberRemoved"), { compactTitle: t("toastRemoveMember") });
          await onRemoved();
        } catch (err) {
          toast.error(
            err instanceof ApiError ? err.message : t("couldNotRemoveMember"),
            t("toastRemoveMember"),
          );
        } finally {
          setBusy(false);
        }
      }}
    />
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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const memberUserIds = useMemo(
    () => new Set(currentMembers.map((member) => member.userId)),
    [currentMembers],
  );
  const searchAvailableMembers = useMemo(
    () => async (query: string) => {
      const candidates = await searchMemberCandidates(query);
      return candidates.filter((user) => !memberUserIds.has(user.id));
    },
    [memberUserIds],
  );

  return (
    <div className="space-y-2 rounded-md border p-3">
      <Label htmlFor={`member-${repoId}`}>{t("addMemberLabel")}</Label>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <UserPicker
          id={`member-${repoId}`}
          value={selectedUserId}
          onChange={setSelectedUserId}
          search={searchAvailableMembers}
          minQueryLength={2}
        />
        <Button
          disabled={busy || !selectedUserId}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd(Number(selectedUserId));
              setSelectedUserId("");
              toast.success(t("memberAdded"), { compactTitle: t("addMemberLabel") });
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.message : t("couldNotAddMember"),
                t("addMemberLabel"),
              );
            } finally {
              setBusy(false);
            }
          }}
          loading={busy}
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Auto-select first challenge once async-loaded prop available
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
              toast.success(t("challengeAddedMsg"), { compactTitle: t("addChallengeLabel") });
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.message : t("couldNotAddChallenge"),
                t("addChallengeLabel"),
              );
            } finally {
              setBusy(false);
            }
          }}
          loading={busy}
        >
          {t("addAction")}
        </Button>
      </div>
    </div>
  );
}
