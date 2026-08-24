"use client";

// Shared judging queue configuration (H46). An enterprise running several
// challenges decides here whether they share one judging queue — one line in
// every queue list, one call per team, one judging form — or keep a queue
// each. An enterprise with a single challenge never sees this card: there is
// nothing to choose.

import { EVENTS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import { LayersIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import {
  type EnterpriseQueueGroup,
  listEnterpriseQueueGroups,
  type MergedPanelPreview,
  mergeQueueGroups,
  previewQueueGroupMerge,
  splitQueueGroup,
  updateQueueGroup,
} from "@/lib/queue";
import { textForDisplay } from "../../challenges/shared";

type Stage = "idle" | "pick" | "review";

function questionLabel(question: Question): string {
  return textForDisplay(question.label) || question.key;
}

export function QueueGroupsCard({ enterpriseId }: { enterpriseId: number }) {
  const { t } = useLocale();
  const [groups, setGroups] = useState<EnterpriseQueueGroup[] | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [picked, setPicked] = useState<number[]>([]);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<MergedPanelPreview | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(await listEnterpriseQueueGroups(enterpriseId));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadQueues"));
      setGroups([]);
    }
  }, [enterpriseId, t]);

  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, liveRefresh]);

  const shared = useMemo(() => groups?.find((group) => group.shared) ?? null, [groups]);
  const challenges = useMemo(() => (groups ?? []).flatMap((group) => group.challenges), [groups]);
  const locked = useMemo(() => (groups ?? []).some((group) => group.judgingStarted), [groups]);

  // Nothing to decide with a single challenge — the queue is that challenge.
  if (groups !== null && challenges.length < 2) return null;

  const startConfiguring = () => {
    setPicked(challenges.map((challenge) => challenge.id));
    setName(shared?.displayName ?? "");
    setPreview(null);
    setDropped([]);
    setStage("pick");
  };

  const toReview = async () => {
    if (picked.length < 2 || !name.trim()) return;
    setBusy(true);
    try {
      setPreview(await previewQueueGroupMerge(enterpriseId, picked));
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
      const group = await mergeQueueGroups(enterpriseId, {
        challengeIds: picked,
        displayName: name.trim(),
      });
      const kept = preview.questions.filter((question) => !dropped.includes(question.key));
      if (kept.length !== preview.questions.length) {
        await updateQueueGroup(group.id, { criteria: kept });
      }
      setStage("idle");
      await load();
      toast.success(t("sharedQueueCreated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueue"));
    } finally {
      setBusy(false);
    }
  };

  const unmerge = async () => {
    if (!shared) return;
    setBusy(true);
    try {
      await splitQueueGroup(enterpriseId, shared.id);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueue"));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!shared || !name.trim() || name.trim() === shared.displayName) return;
    setBusy(true);
    try {
      await updateQueueGroup(shared.id, { displayName: name.trim() });
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveQueue"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      icon={LayersIcon}
      title={t("judgingQueues")}
      // The one rule that is neither visible nor reversible from this screen.
      description={locked ? t("queuesLockedOnceJudgingStarts") : undefined}
    >
      {groups === null ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`shared-queue-${enterpriseId}`}>{t("oneSharedQueue")}</Label>
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
                onConfirm={unmerge}
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
                          {preview.renamedKeys.some((r) => r.to === question.key) && (
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

          {stage === "idle" && (
            <ul className="divide-border divide-y">
              {groups.map((group) => (
                <li key={group.id} className="space-y-1 py-2.5">
                  <p className="truncate text-sm font-medium">{group.displayName}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {group.challenges.map((challenge) => challenge.title).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {stage === "idle" && shared && !locked && (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                aria-label={t("queueName")}
                value={name || shared.displayName}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={busy || !name.trim() || name.trim() === shared.displayName}
                onClick={() => void rename()}
              >
                {t("save")}
              </Button>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
