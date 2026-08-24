"use client";

// The all-queues management view (H46) — the "Queues" tab of queue
// operations, the queue-keyed projection of what the "Rooms" tab shows
// room-keyed. Scope is the caller's authority: a queue/sponsor administrator
// manages every queue on the platform, a sponsor representative only their own
// enterprises'. A queue serving no room is only visible here.
//
// Grouped by enterprise on purpose. "One shared queue or one per challenge" is
// a decision about an ENTERPRISE (plan §"Enterprise queue-group
// configuration"), not a property of any one queue: turning it on absorbs that
// enterprise's other queues. So the switch sits on the enterprise row, with
// the queues it would merge listed directly underneath — an enterprise with a
// single challenge has nothing to decide and gets no switch.
//
// Naming and merging live here rather than on the enterprise profile so an
// admin does not have to know which enterprise to open first.

import type { Question } from "@hackos/shared/questions";
import { LayersIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
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

type Stage = "idle" | "pick" | "review";

interface EnterpriseQueues {
  enterpriseId: number;
  enterpriseName: string;
  queues: QueueGroup[];
  challenges: Array<{ id: number; title: string }>;
  shared: QueueGroup | null;
  /** Some team here has been evaluated: the configuration is frozen. */
  locked: boolean;
}

function questionLabel(question: Question): string {
  return textForDisplay(question.label) || question.key;
}

function byEnterprise(groups: QueueGroup[]): EnterpriseQueues[] {
  const map = new Map<number, EnterpriseQueues>();
  for (const queue of groups) {
    let entry = map.get(queue.enterpriseId);
    if (!entry) {
      entry = {
        enterpriseId: queue.enterpriseId,
        enterpriseName: queue.enterpriseName,
        queues: [],
        challenges: [],
        shared: null,
        locked: false,
      };
      map.set(queue.enterpriseId, entry);
    }
    entry.queues.push(queue);
    entry.challenges.push(...queue.challenges);
    if (queue.shared) entry.shared = queue;
    if (queue.evaluationStarted) entry.locked = true;
  }
  return [...map.values()];
}

export function QueuesPanel() {
  const { t } = useLocale();
  const [groups, setGroups] = useState<QueueGroup[] | null>(null);

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

  const enterprises = useMemo(() => byEnterprise(groups ?? []), [groups]);

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
    <div className="space-y-4">
      {enterprises.map((enterprise) => (
        <EnterpriseQueuesCard
          key={enterprise.enterpriseId}
          enterprise={enterprise}
          onChanged={load}
        />
      ))}
    </div>
  );
}

/** One enterprise: its shared-vs-per-challenge choice, and the queues it runs. */
function EnterpriseQueuesCard({
  enterprise,
  onChanged,
}: {
  enterprise: EnterpriseQueues;
  onChanged: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [stage, setStage] = useState<Stage>("idle");
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<MergedPanelPreview | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { enterpriseId, challenges, shared, locked } = enterprise;
  // Nothing to decide for an enterprise running a single challenge.
  const canShare = challenges.length > 1;

  const startConfiguring = () => {
    setPicked(challenges.map((challenge) => challenge.id));
    setName(t("sharedQueueDefaultName", { enterprise: enterprise.enterpriseName }));
    setPreview(null);
    setDropped([]);
    setStage("pick");
  };

  const guard = async (action: () => Promise<unknown>) => {
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

  const toReview = () =>
    guard(async () => {
      setPreview(await previewQueueGroupMerge(enterpriseId, picked));
      setDropped([]);
      setStage("review");
    });

  const confirm = () =>
    guard(async () => {
      if (!preview) return;
      const merged = await mergeQueueGroups(enterpriseId, {
        challengeIds: picked,
        displayName: name.trim(),
      });
      const kept = preview.questions.filter((question) => !dropped.includes(question.key));
      if (kept.length !== preview.questions.length) {
        await updateQueueGroup(merged.id, { criteria: kept });
      }
      setStage("idle");
      toast.success(t("sharedQueueCreated"));
    });

  return (
    <SectionCard
      title={enterprise.enterpriseName}
      icon={LayersIcon}
      // The one rule this screen cannot undo, and the only reason a switch
      // here is ever disabled.
      description={locked ? t("queuesLockedOnceJudgingStarts") : undefined}
      bodyClassName="space-y-4"
      action={
        canShare ? (
          <div className="flex items-center gap-2">
            <Label htmlFor={`shared-queue-${enterpriseId}`} className="font-normal">
              {t("oneSharedQueue")}
            </Label>
            {shared ? (
              <AlertModal
                title={t("splitSharedQueueTitle")}
                description={t("splitSharedQueueDesc")}
                cancelLabel={t("cancel")}
                confirmLabel={t("splitSharedQueue")}
                destructive
                pending={busy}
                trigger={
                  <Switch id={`shared-queue-${enterpriseId}`} checked disabled={busy || locked} />
                }
                onConfirm={() => guard(() => splitQueueGroup(enterpriseId, shared.id))}
              />
            ) : (
              <Switch
                id={`shared-queue-${enterpriseId}`}
                checked={stage !== "idle"}
                disabled={busy || locked}
                onCheckedChange={(on) => (on ? startConfiguring() : setStage("idle"))}
              />
            )}
          </div>
        ) : undefined
      }
    >
      {stage === "idle" && (
        <ul className="divide-border divide-y">
          {enterprise.queues.map((queue) => (
            <li key={queue.id}>
              <Link
                href={`/queue/queues/${queue.id}`}
                className="hover:bg-muted/50 -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{queue.displayName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {queue.challenges.map((challenge) => challenge.title).join(" · ")}
                  </p>
                </div>
                {queue.shared && (
                  <StatusBadge tone="info" className="shrink-0">
                    {t("sharedQueueBadge", { count: queue.challenges.length })}
                  </StatusBadge>
                )}
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {t("queueTeamCount", { count: queue.teams })}
                </span>
                <span className="text-muted-foreground w-40 shrink-0 truncate text-right text-xs">
                  {queue.rooms.length
                    ? queue.rooms.map((room) => room.name).join(", ")
                    : t("noRoomServingQueue")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {stage === "pick" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`queue-name-${enterpriseId}`}>{t("queueName")}</Label>
            <Input
              id={`queue-name-${enterpriseId}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("challengesInThisQueue")}</Label>
            <ul className="divide-border divide-y">
              {challenges.map((challenge) => (
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
    </SectionCard>
  );
}
