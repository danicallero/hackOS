"use client";

// The all-queues management view (H46) — the "Queues" tab of queue
// operations, the queue-keyed projection of what the "Rooms" tab shows
// room-keyed. Scope is the caller's authority: a queue/sponsor administrator
// manages every queue on the platform, a sponsor representative only their own
// enterprises'. A queue serving no room is only visible here.
//
// What a queue is called, and whether an enterprise's challenges share one
// queue or get one each, are edited here rather than on the enterprise
// profile: an admin should not have to know which enterprise to open first.

import type { Question } from "@hackos/shared/questions";
import { LayersIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  listQueueGroups,
  type MergedPanelPreview,
  mergeQueueGroups,
  previewQueueGroupMerge,
  type QueueGroup,
  splitQueueGroup,
  updateQueueGroup,
} from "@/lib/queue";
import { textForDisplay } from "../challenges/shared";
import { ChallengeResultsPanel } from "./rooms/room-panels";

type Stage = "idle" | "pick" | "review";

function questionLabel(question: Question): string {
  return textForDisplay(question.label) || question.key;
}

export function QueuesPanel() {
  const { t } = useLocale();
  const [groups, setGroups] = useState<QueueGroup[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups(await listQueueGroups());
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadQueues"));
      setGroups([]);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const open = useMemo(
    () => (groups ?? []).find((group) => group.id === openId) ?? null,
    [groups, openId],
  );

  // Configuring a shared queue is a per-enterprise decision, so the picker
  // offers exactly that enterprise's queues.
  const siblings = useMemo(
    () => (open ? (groups ?? []).filter((group) => group.enterpriseId === open.enterpriseId) : []),
    [groups, open],
  );

  if (groups === null) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5" />
      </div>
    );
  }

  if (groups.length === 0) {
    return <EmptyState icon={LayersIcon} title={t("noQueuesYet")} />;
  }

  return (
    <>
      <SectionCard title={t("judgingQueues")} icon={LayersIcon} bodyClassName="p-0">
        <ul className="divide-border divide-y">
          {groups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className="hover:bg-muted/50 flex w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() => setOpenId(group.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{group.displayName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {group.enterpriseName}
                    {group.shared ? ` · ${group.challenges.map((c) => c.title).join(" · ")}` : ""}
                  </p>
                </div>
                {group.shared && (
                  <StatusBadge tone="info" className="shrink-0">
                    {t("sharedQueueBadge", { count: group.challenges.length })}
                  </StatusBadge>
                )}
                <span className="text-muted-foreground shrink-0 text-xs">
                  {group.rooms.length
                    ? group.rooms.map((room) => room.name).join(", ")
                    : t("noRoomServingQueue")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </SectionCard>

      <Modal
        open={open !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setOpenId(null);
        }}
        title={open?.displayName ?? ""}
        description={open?.enterpriseName}
        size="xl"
      >
        {open && (
          <QueueEditor
            group={open}
            siblings={siblings}
            onChanged={async () => {
              await load();
            }}
            onClose={() => setOpenId(null)}
          />
        )}
      </Modal>
    </>
  );
}

/** Rename, shared-vs-per-challenge, merged-form review, and team lookup. */
function QueueEditor({
  group,
  siblings,
  onChanged,
  onClose,
}: {
  group: QueueGroup;
  siblings: QueueGroup[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [stage, setStage] = useState<Stage>("idle");
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState(group.displayName);
  const [preview, setPreview] = useState<MergedPanelPreview | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const enterpriseChallenges = useMemo(
    () => siblings.flatMap((sibling) => sibling.challenges),
    [siblings],
  );
  // The choice only exists for an enterprise running more than one challenge.
  const canShare = enterpriseChallenges.length > 1;
  const locked = siblings.some((sibling) => sibling.judgingStarted);

  const startConfiguring = () => {
    setPicked(enterpriseChallenges.map((challenge) => challenge.id));
    setPreview(null);
    setDropped([]);
    setStage("pick");
  };

  const toReview = async () => {
    setBusy(true);
    try {
      setPreview(await previewQueueGroupMerge(group.enterpriseId, picked));
      setDropped([]);
      setStage("review");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadQueues"));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const merged = await mergeQueueGroups(group.enterpriseId, {
        challengeIds: picked,
        displayName: name.trim() || group.displayName,
      });
      const kept = preview.questions.filter((question) => !dropped.includes(question.key));
      if (kept.length !== preview.questions.length) {
        await updateQueueGroup(merged.id, { criteria: kept });
      }
      await onChanged();
      onClose();
      toast.success(t("sharedQueueCreated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueue"));
    } finally {
      setBusy(false);
    }
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueue"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Label htmlFor={`queue-name-${group.id}`}>{t("queueName")}</Label>
          <Input
            id={`queue-name-${group.id}`}
            value={name}
            disabled={!group.shared}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {group.shared && (
          <Button
            variant="outline"
            className="self-end"
            disabled={busy || !name.trim() || name.trim() === group.displayName}
            onClick={() => void run(() => updateQueueGroup(group.id, { displayName: name.trim() }))}
          >
            {t("save")}
          </Button>
        )}
      </div>

      {canShare && (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={`shared-queue-${group.id}`}>{t("oneSharedQueue")}</Label>
          {group.shared ? (
            <AlertModal
              title={t("splitSharedQueueTitle")}
              description={t("splitSharedQueueDesc")}
              cancelLabel={t("cancel")}
              confirmLabel={t("splitSharedQueue")}
              destructive
              pending={busy}
              trigger={<Switch id={`shared-queue-${group.id}`} checked disabled={busy || locked} />}
              onConfirm={() =>
                run(async () => {
                  await splitQueueGroup(group.enterpriseId, group.id);
                  onClose();
                })
              }
            />
          ) : (
            <Switch
              id={`shared-queue-${group.id}`}
              checked={stage !== "idle"}
              disabled={busy || locked}
              onCheckedChange={(on) => (on ? startConfiguring() : setStage("idle"))}
            />
          )}
        </div>
      )}

      {locked && !group.shared && stage === "idle" && (
        <p className="text-muted-foreground text-sm">{t("queuesLockedOnceJudgingStarts")}</p>
      )}

      {stage === "pick" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("challengesInThisQueue")}</Label>
            <ul className="divide-border divide-y">
              {enterpriseChallenges.map((challenge) => (
                <li key={challenge.id} className="flex items-center gap-3 py-2.5">
                  <Checkbox
                    id={`queue-challenge-${challenge.id}`}
                    checked={picked.includes(challenge.id)}
                    onCheckedChange={(on) =>
                      setPicked((current) =>
                        on
                          ? [...current, challenge.id]
                          : current.filter((id) => id !== challenge.id),
                      )
                    }
                  />
                  <Label
                    htmlFor={`queue-challenge-${challenge.id}`}
                    className="min-w-0 flex-1 truncate font-normal"
                  >
                    {challenge.title}
                  </Label>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStage("idle")} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              onClick={() => void toReview()}
              disabled={busy || picked.length < 2 || !name.trim()}
            >
              {t("continue")}
            </Button>
          </div>
        </div>
      )}

      {stage === "review" && preview && (
        <div className="space-y-4">
          <Label>{t("mergedJudgingForm")}</Label>
          {preview.questions.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("noJudgingQuestions")}</p>
          ) : (
            <ul className="divide-border divide-y">
              {preview.questions.map((question) => {
                const removed = dropped.includes(question.key);
                return (
                  <li key={question.key} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${removed ? "text-muted-foreground line-through" : ""}`}
                      >
                        {questionLabel(question)}
                      </p>
                      {preview.renamedKeys.some((renamed) => renamed.to === question.key) && (
                        <p className="text-muted-foreground truncate text-xs">
                          {t("questionKeyRenamed", { key: question.key })}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        setDropped((current) =>
                          removed
                            ? current.filter((key) => key !== question.key)
                            : [...current, question.key],
                        )
                      }
                    >
                      {removed ? t("restore") : t("remove")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStage("pick")} disabled={busy}>
              {t("back")}
            </Button>
            <Button onClick={() => void confirm()} disabled={busy}>
              {t("createSharedQueue")}
            </Button>
          </div>
        </div>
      )}

      {stage === "idle" && group.challenges[0] && (
        <SectionCard title={t("queueTeams")} icon={SearchIcon}>
          {/* Progress and team lookup read the queue through any of its
              challenges — a shared queue is one ordering across all of them. */}
          <ChallengeResultsPanel challengeId={group.challenges[0].id} />
        </SectionCard>
      )}
    </div>
  );
}
