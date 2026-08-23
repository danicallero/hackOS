"use client";
import { LinkIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { linkSecondaryEmail, removeDevpostParticipant, removeRepoMember } from "@/lib/projects";
import { type ChallengeOption, challengeTitleText, type ProjectRepo } from "../shared";

async function searchMemberCandidates(query: string): Promise<UserOption[]> {
  const result = await api.get<{ users: UserOption[] }>("/api/projects/member-candidates", {
    query: { q: query, limit: 20 },
  });
  return result.users;
}

export function MemberRemoveButton({
  repoId,
  userId,
  email,
  imported,
  secondaryLinked = false,
  onRemoved,
}: {
  repoId: number;
  userId: number;
  email: string | null;
  imported: boolean;
  secondaryLinked?: boolean;
  onRemoved: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const title = secondaryLinked
    ? t("unlinkSecondaryProjectAccountTitle")
    : t("removeProjectMemberTitle");
  const description = secondaryLinked
    ? t("unlinkSecondaryProjectAccountDesc")
    : imported
      ? t("removeImportedParticipantDesc")
      : t("removeProjectMemberDesc");
  const confirmLabel = secondaryLinked ? t("unlinkSecondaryProjectAccountAction") : t("remove");
  return (
    <AlertModal
      title={title}
      description={description}
      cancelLabel={t("cancel")}
      confirmLabel={confirmLabel}
      destructive
      pending={busy}
      trigger={
        <Button variant="outline" size="sm">
          {confirmLabel}
        </Button>
      }
      onConfirm={async () => {
        setBusy(true);
        try {
          if (imported && email) await removeDevpostParticipant(repoId, email);
          else await removeRepoMember(repoId, userId);
          toast.success(t("memberRemoved"));
          await onRemoved();
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveMember"));
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

export function DevpostParticipantActions({
  repoId,
  email,
  canDelete,
  canLink,
  onChanged,
}: {
  repoId: number;
  email: string;
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
            <div id={dialogId} className="grid w-full gap-2">
              <Label htmlFor={`${dialogId}-user`} className="sr-only">
                {t("userForEmail", { email })}
              </Label>
              <UserPicker
                id={`${dialogId}-user`}
                value={selectedUserId}
                onChange={setSelectedUserId}
                search={searchMemberCandidates}
                minQueryLength={2}
              />
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
        <AlertModal
          title={t("removeImportedParticipantTitle")}
          description={t("removeImportedParticipantDesc")}
          cancelLabel={t("cancel")}
          confirmLabel={t("deleteAction")}
          destructive
          pending={busy === "delete"}
          trigger={
            <Button type="button" variant="outline" size="sm" disabled={busy !== null}>
              <Trash2Icon className="size-4" />
              {t("deleteAction")}
            </Button>
          }
          onConfirm={deleteParticipant}
        />
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
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState(false);

  const memberUserIds = useMemo(
    () =>
      new Set(currentMembers.flatMap((member) => (member.userId === null ? [] : [member.userId]))),
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
