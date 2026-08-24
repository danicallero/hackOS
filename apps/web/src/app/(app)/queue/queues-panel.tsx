"use client";

// The all-queues management view (H46) — the "Queues" tab of queue
// operations, the queue-keyed projection of what the "Rooms" tab shows
// room-keyed. Scope is the caller's authority: a queue/sponsor administrator
// manages every queue on the platform, a sponsor representative only their own
// enterprises'. A queue serving no room is only visible here.
//
// Grouped by enterprise on purpose. Shared-queue configuration is a decision
// about which challenges belong together, and one enterprise may have several
// shared queues. The add action therefore sits on the enterprise row while
// each existing shared queue owns its own split action.
//
// Naming and merging live here rather than on the enterprise profile so an
// admin does not have to know which enterprise to open first.

import type { Question } from "@hackos/shared/questions";
import {
  ArrowUpRightIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TrophyIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { JudgingPanelBuilder, normalizeQuestions } from "@/components/common/questionnaire-builder";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useScrollRestoration } from "@/hooks/use-scroll-restoration";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  clearQueue,
  generateQueue,
  listQueueGroups,
  type MergedPanelPreview,
  mergeQueueGroups,
  previewQueueGroupMerge,
  type QueueGroup,
  splitQueueGroup,
  updateQueueGroup,
} from "@/lib/queue";
import { queueSummaryValues } from "@/lib/queue-summary";

type Stage = "idle" | "pick" | "review";

interface EnterpriseQueues {
  enterpriseId: number;
  enterpriseName: string;
  logoUrl: string | null;
  logoNegativeUrl: string | null;
  queues: QueueGroup[];
  challenges: Array<{ id: number; title: string }>;
}

function byEnterprise(groups: QueueGroup[]): EnterpriseQueues[] {
  const map = new Map<number, EnterpriseQueues>();
  for (const queue of groups) {
    let entry = map.get(queue.enterpriseId);
    if (!entry) {
      entry = {
        enterpriseId: queue.enterpriseId,
        enterpriseName: queue.enterpriseName,
        logoUrl: queue.enterpriseLogoUrl,
        logoNegativeUrl: queue.enterpriseLogoNegativeUrl,
        queues: [],
        challenges: [],
      };
      map.set(queue.enterpriseId, entry);
    }
    entry.queues.push(queue);
    entry.challenges.push(...queue.challenges);
  }
  return [...map.values()];
}

export function QueuesPanel() {
  const { t } = useLocale();
  const [groups, setGroups] = useState<QueueGroup[] | null>(null);
  useScrollRestoration("queue-queues-list:scroll", groups !== null);

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

/** One enterprise: its available challenges and the queues it runs. */
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
  const [reviewQuestions, setReviewQuestions] = useState<Question[]>([]);
  const [busy, setBusy] = useState(false);
  const [splitQueueId, setSplitQueueId] = useState<number | null>(null);
  const [clearQueueId, setClearQueueId] = useState<number | null>(null);
  const [queueActionBusyId, setQueueActionBusyId] = useState<number | null>(null);

  const { enterpriseId } = enterprise;
  const availableChallenges = enterprise.queues
    .filter((queue) => !queue.shared && !queue.evaluationStarted)
    .flatMap((queue) => queue.challenges);
  const canAddSharedQueue = availableChallenges.length > 1;

  const startConfiguring = () => {
    setPicked(availableChallenges.map((challenge) => challenge.id));
    setName(t("sharedQueueDefaultName", { enterprise: enterprise.enterpriseName }));
    setPreview(null);
    setReviewQuestions([]);
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
      const nextPreview = await previewQueueGroupMerge(enterpriseId, picked);
      setPreview(nextPreview);
      setReviewQuestions(nextPreview.questions);
      setStage("review");
    });

  const confirm = () =>
    guard(async () => {
      if (!preview) return;
      const merged = await mergeQueueGroups(enterpriseId, {
        challengeIds: picked,
        displayName: name.trim(),
      });
      const normalized = normalizeQuestions(reviewQuestions);
      if (JSON.stringify(normalized) !== JSON.stringify(preview.questions)) {
        await updateQueueGroup(merged.id, { criteria: normalized });
      }
      setStage("idle");
      toast.success(t("sharedQueueCreated"));
    });

  const generateOneQueue = async (queueId: number) => {
    setQueueActionBusyId(queueId);
    try {
      const result = await generateQueue(queueId);
      await onChanged();
      toast.success(t("queueGenerated", { count: result.inserted + result.revived }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotGenerateQueues"));
    } finally {
      setQueueActionBusyId(null);
    }
  };

  const clearOneQueue = async () => {
    if (clearQueueId === null) return;
    const queueId = clearQueueId;
    setQueueActionBusyId(queueId);
    try {
      await clearQueue(queueId);
      setClearQueueId(null);
      await onChanged();
      toast.success(t("queueCleared"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotClearQueue"));
    } finally {
      setQueueActionBusyId(null);
    }
  };

  return (
    <SectionCard
      title={enterprise.enterpriseName}
      leading={
        enterprise.logoUrl ? (
          <span className="bg-muted outline-border flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md p-0.5 outline -outline-offset-1">
            <SponsorLogo
              logoUrl={enterprise.logoUrl}
              logoNegativeUrl={enterprise.logoNegativeUrl}
              alt={enterprise.enterpriseName}
              className="size-full rounded object-contain"
            />
          </span>
        ) : (
          <LayersIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
        )
      }
      bodyClassName="space-y-4"
      action={
        canAddSharedQueue ? (
          <Button
            variant="outline"
            size="sm"
            onClick={startConfiguring}
            disabled={busy || queueActionBusyId !== null}
          >
            <PlusIcon className="size-4" />
            {t("addSharedQueue")}
          </Button>
        ) : undefined
      }
    >
      {stage === "idle" && (
        <ul className="space-y-2">
          {enterprise.queues.map((queue) => (
            <li
              key={queue.id}
              className="border-border/70 hover:bg-muted/30 flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors"
            >
              <Link
                href={`/queue/queues/${queue.id}`}
                className="group flex min-w-0 flex-1 items-center gap-3"
              >
                <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md">
                  {queue.shared ? (
                    <LayersIcon className="size-4" aria-hidden="true" />
                  ) : (
                    <TrophyIcon className="size-4" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="group-hover:underline truncate text-sm font-medium">
                    {queue.displayName}
                  </p>
                  {queue.challenges.length > 1 && (
                    <p className="text-muted-foreground truncate text-xs">
                      {queue.challenges.map((challenge) => challenge.title).join(" · ")}
                    </p>
                  )}
                  <p className="text-muted-foreground truncate text-xs tabular-nums">
                    {t(
                      queue.challenges.length > 1
                        ? "queueSummary"
                        : "queueSummaryWithoutChallenges",
                      queueSummaryValues(t, {
                        challenges: queue.challenges.length,
                        rooms: queue.rooms.length,
                        teams: queue.teams,
                      }),
                    )}
                  </p>
                </div>
                <ArrowUpRightIcon
                  className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
                  aria-hidden="true"
                />
              </Link>
              <div className="flex shrink-0 items-center gap-1">
                {queue.shared && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || queueActionBusyId !== null || queue.evaluationStarted}
                    onClick={() => setSplitQueueId(queue.id)}
                  >
                    {t("splitSharedQueue")}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy || queueActionBusyId !== null}
                      aria-label={t("queueActions")}
                    >
                      <MoreHorizontalIcon className="size-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void generateOneQueue(queue.id)}>
                      <RefreshCwIcon className="size-4" aria-hidden="true" />
                      {t("generateQueue")}
                    </DropdownMenuItem>
                    {!queue.evaluationStarted && (
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setClearQueueId(queue.id)}
                      >
                        <Trash2Icon className="size-4" aria-hidden="true" />
                        {t("clearQueue")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={stage !== "idle"}
        onOpenChange={(open) => {
          if (!open && !busy) setStage("idle");
        }}
        title={t("addSharedQueue")}
        description={t("addSharedQueueDescription")}
        size="xl"
      >
        {stage === "pick" && (
          <div className="space-y-5 pb-1">
            <h3 className="type-section-title">{t("sharedQueueStepChoose")}</h3>
            <div className="space-y-2">
              <Label htmlFor={`queue-name-${enterpriseId}`}>{t("queueName")}</Label>
              <Input
                id={`queue-name-${enterpriseId}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div>
                <Label>{t("challengesInThisQueue")}</Label>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t("sharedQueueChallengeDescription")}
                </p>
              </div>
              <ul className="divide-border divide-y rounded-md border">
                {availableChallenges.map((challenge) => (
                  <li key={challenge.id} className="flex items-center gap-3 px-3 py-2.5">
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
          <div className="space-y-5 pb-1">
            <h3 className="type-section-title">{t("sharedQueueStepReview")}</h3>
            <div>
              <Label>{t("mergedJudgingForm")}</Label>
              <p className="text-muted-foreground mt-1 text-sm text-pretty">
                {t("sharedQueueReviewDescription")}
              </p>
            </div>
            <JudgingPanelBuilder
              value={reviewQuestions}
              onChange={setReviewQuestions}
              disabled={busy}
            />
            {preview.renamedKeys.length > 0 && (
              <ul className="text-muted-foreground space-y-1 text-xs">
                {preview.renamedKeys.map((renamed) => (
                  <li key={`${renamed.from}-${renamed.to}`}>
                    {t("questionKeyRenamed", { key: renamed.to })}
                  </li>
                ))}
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
      </Modal>

      <AlertModal
        open={splitQueueId !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSplitQueueId(null);
        }}
        title={t("splitSharedQueueTitle")}
        description={t("splitSharedQueueDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("splitSharedQueue")}
        destructive
        pending={busy}
        onConfirm={() =>
          void guard(async () => {
            if (splitQueueId === null) return;
            await splitQueueGroup(enterpriseId, splitQueueId);
            setSplitQueueId(null);
          })
        }
      />

      <AlertModal
        open={clearQueueId !== null}
        onOpenChange={(open) => {
          if (!open && queueActionBusyId === null) setClearQueueId(null);
        }}
        title={t("clearQueueTitle")}
        description={t("clearQueueDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={t("clearQueue")}
        destructive
        pending={queueActionBusyId === clearQueueId}
        onConfirm={() => void clearOneQueue()}
      />
    </SectionCard>
  );
}
