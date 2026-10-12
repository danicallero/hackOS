"use client";

// The room's right column (H36-H39): who is presenting, their project, and
// the presentation clock.

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Surface } from "@/components/ui/surface";
import { useLocale } from "@/lib/i18n";
import {
  canTransition,
  preparationElapsedSeconds,
  presentationTimerState,
} from "@/lib/judging-workspace";
import {
  collapseRepoQueueMemberships,
  getRepoChallenges,
  type QueueEntry,
  type RepoChallenge,
} from "@/lib/queue";
import { cn } from "@/lib/utils";
import type { Challenge } from "../challenges/shared";
import { challengeName, entryLabel, secondsLabel } from "./helpers";
import { JudgingEmptyState } from "./judging-empty-state";

export function PresentationPanel({
  entry,
  challenge,
  waitingRoomCount,
  firstCalledEntry,
  canJudge,
  canOperate,
  busy,
  onEntryAction,
}: {
  entry: QueueEntry | null;
  challenge: Challenge | null;
  waitingRoomCount: number;
  /** Front of the waiting room (status `called`) — powers the "bring in next" shortcut. */
  firstCalledEntry: QueueEntry | null;
  canJudge: boolean;
  canOperate: boolean;
  busy: string | null;
  onEntryAction: (
    entry: QueueEntry,
    action:
      | "pause-timer"
      | "resume-timer"
      | "start"
      | "complete"
      | "send-back"
      | "bring-in"
      | "notify-enter",
    body: Record<string, unknown> | undefined,
    label: string,
  ) => void;
}) {
  const { t } = useLocale();
  const isPresenting = entry?.status === "presenting";
  const isReady = entry?.status === "in_room";
  // H33 (#59): a team that already reached the room or the stage can be sent
  // back to the top of the waiting room. This is a judging decision, so it only
  // lives here in the Judging Panel — never in the Queue Operations view.
  const canSendBack = isPresenting || isReady;
  // #926: one derivation of the clock action, gated by the shared state machine.
  const nextTimerAction = entry?.presentation_paused_at ? "resume-timer" : "pause-timer";
  const timerAction =
    entry && canTransition(entry.status, nextTimerAction) ? nextTimerAction : null;
  const timerLabel =
    timerAction === "resume-timer" ? "resumePresentationTimer" : "pausePresentationTimer";

  return (
    <Surface
      padding="none"
      className={cn("overflow-hidden", entry && "border-primary/30 bg-primary/5")}
    >
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-balance">
            {entry ? entryLabel(entry, t) : t("waitingForNextTeam")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {entry
              ? isPresenting
                ? t("presentationInProgress")
                : isReady
                  ? t("readyToStart")
                  : t("teamInRoom")
              : t("bringTeamPrompt")}
          </p>
        </div>
        {entry ? (
          <QueueStatusBadge status={entry.status} />
        ) : (
          <StatusBadge tone="neutral">{t("idle")}</StatusBadge>
        )}
      </div>
      <Separator />
      <div className="space-y-4 p-5">
        {!entry ? (
          <JudgingEmptyState
            icon={DoorOpenIcon}
            title={t("noPresentationInProgress")}
            description={waitingRoomCount > 0 ? t("teamsWaitingDoor") : t("callNextTeamPrompt")}
            action={
              <>
                {firstCalledEntry && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(!canOperate && !canJudge) || busy != null}
                    loading={busy === `notify-enter-${firstCalledEntry.id}`}
                    onClick={() =>
                      onEntryAction(
                        firstCalledEntry,
                        "notify-enter",
                        undefined,
                        t("entranceNoticeSent"),
                      )
                    }
                  >
                    <PaperPlaneTiltIcon aria-hidden="true" className="size-4" />
                    {t("callNextTeam")}
                  </Button>
                )}
                {waitingRoomCount > 0 && firstCalledEntry && (
                  <Button
                    size="sm"
                    disabled={!canJudge || busy != null}
                    loading={busy === `bring-in-${firstCalledEntry.id}`}
                    onClick={() =>
                      onEntryAction(
                        firstCalledEntry,
                        "bring-in",
                        undefined,
                        t("teamBroughtInShort"),
                      )
                    }
                  >
                    <DoorOpenIcon aria-hidden="true" className="size-4" />
                    {t("bringInNextTeam")}
                  </Button>
                )}
              </>
            }
          />
        ) : (
          <>
            <ProjectInfo entry={entry} challenge={challenge} />

            {(isReady || isPresenting) && (
              <PreparationTimer
                enteredAt={entry.room_entered_at ?? null}
                startedAt={entry.presentation_started_at}
              />
            )}

            {isPresenting && (
              <PresentationTimer
                startedAt={entry.presentation_started_at}
                totalMinutes={
                  entry.presentation_total_seconds != null
                    ? entry.presentation_total_seconds / 60
                    : null
                }
                pausedAt={entry.presentation_paused_at ?? null}
                pausedSeconds={entry.presentation_paused_seconds ?? 0}
              />
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              {timerAction ? (
                <Button
                  variant="outline"
                  disabled={!canJudge || busy != null}
                  loading={busy === `${timerAction}-${entry.id}`}
                  onClick={() => onEntryAction(entry, timerAction, undefined, t(timerLabel))}
                >
                  {timerAction === "resume-timer" ? (
                    <PlayIcon aria-hidden="true" className="size-4" />
                  ) : (
                    <PauseIcon aria-hidden="true" className="size-4" />
                  )}
                  {t(timerLabel)}
                </Button>
              ) : (
                <Button
                  disabled={!canJudge || !isReady || busy != null}
                  loading={busy === `start-${entry.id}`}
                  onClick={() => onEntryAction(entry, "start", undefined, t("presentationStarted"))}
                >
                  <PlayIcon aria-hidden="true" className="size-4" />
                  {t("start")}
                </Button>
              )}
              {canSendBack && (
                <AlertModal
                  title={t("confirmSendBackTitle")}
                  description={t("confirmSendBackDescription")}
                  cancelLabel={t("cancel")}
                  confirmLabel={t("requeueWaitingRoom")}
                  autoClose
                  onConfirm={() =>
                    onEntryAction(
                      entry,
                      "send-back",
                      { reason: "Re-queued to waiting room" },
                      t("teamSentBackWaiting"),
                    )
                  }
                  trigger={
                    <Button
                      variant="outline"
                      disabled={!canJudge || busy != null}
                      loading={busy === `send-back-${entry.id}`}
                    >
                      <ArrowCounterClockwiseIcon aria-hidden="true" className="size-4" />
                      {t("requeueWaitingRoom")}
                    </Button>
                  }
                />
              )}
            </div>
          </>
        )}
      </div>
    </Surface>
  );
}

export function ProjectInfo({
  entry,
  challenge,
}: {
  entry: QueueEntry;
  challenge: Challenge | null;
}) {
  const { t } = useLocale();
  const members = entry.repo_members ?? [];
  // GitHub first — it's the artifact judges actually need to open.
  const links = [
    { label: "GitHub", href: entry.repo_github_url },
    { label: "Devpost", href: entry.repo_devpost_url },
    { label: "Demo", href: entry.repo_demo_url },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  const [repoChallenges, setRepoChallenges] = useState<RepoChallenge[]>([]);
  useEffect(() => {
    let cancelled = false;
    getRepoChallenges(entry.repo_id)
      .then((rows) => {
        if (!cancelled) setRepoChallenges(rows);
      })
      .catch(() => {
        if (!cancelled) setRepoChallenges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.repo_id]);

  return (
    <div className="space-y-2">
      <div className="grid gap-x-4 gap-y-2 rounded-md border bg-background p-3 sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-2">
          <UsersIcon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase">{t("membersLabel")}</p>
            <p className="text-sm font-medium text-pretty">
              {members.length > 0
                ? members
                    .map(
                      (member) =>
                        `${member.name ?? ""} ${member.surname ?? ""}`.trim() || member.email,
                    )
                    .join(" · ")
                : "—"}
            </p>
          </div>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase">{t("projectLabel")}</p>
          <p className="truncate text-sm font-medium">{entryLabel(entry, t)}</p>
        </div>
      </div>

      {links.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {links.map((link, i) => (
            <Button key={link.label} variant={i === 0 ? "default" : "outline"} size="sm" asChild>
              <a href={link.href} target="_blank" rel="noreferrer">
                <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
                {link.label}
              </a>
            </Button>
          ))}
        </div>
      )}

      {/* A project can be in more than one queue. Shared queue siblings collapse
          to one row and are named by the queue group. */}
      {(repoChallenges.length > 0 || challenge) && (
        <div className="rounded-md border bg-background p-3">
          <p className="mb-1 text-xs font-semibold uppercase">{t("queueName")}</p>
          <ul className="space-y-1.5">
            {(repoChallenges.length > 0
              ? collapseRepoQueueMemberships(repoChallenges)
              : challenge
                ? [
                    {
                      id: entry.challenge_id,
                      title: challengeName(t, challenge, entry.challenge_id),
                      queue_name: null,
                      status: entry.status,
                      room_id: null,
                      room_name: null,
                    },
                  ]
                : []
            ).map((rc) => (
              <li key={rc.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{rc.queue_name ?? rc.title}</span>
                <div className="flex items-center gap-2">
                  {rc.room_name && (
                    <span className="text-muted-foreground text-xs">{rc.room_name}</span>
                  )}
                  {rc.id === entry.challenge_id ? (
                    <StatusBadge tone="success">{t("now")}</StatusBadge>
                  ) : (
                    <QueueStatusBadge status={rc.status} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PresentationTimer({
  startedAt,
  totalMinutes,
  pausedAt = null,
  pausedSeconds = 0,
}: {
  pausedAt?: string | null;
  pausedSeconds?: number;
  startedAt: string | null;
  /** Already capped by the challenge's max and squeezed for remaining time (H39). */
  totalMinutes: number | null;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(() => Date.now());

  // #926: every judge and reload uses the persisted goal and pause state.
  const {
    elapsedSeconds,
    totalSeconds,
    progressValue,
    tone: timerTone,
  } = presentationTimerState(startedAt, totalMinutes, now, pausedAt, pausedSeconds);
  const cueText = pausedAt
    ? t("presentationTimerPaused")
    : timerTone === "danger"
      ? t("timeLimitExceeded")
      : timerTone === "warning"
        ? t("wrapUp")
        : t("onTime");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-1.5">
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums whitespace-nowrap",
          timerTone === "warning" && "text-warning",
          timerTone === "danger" && "text-destructive",
        )}
      >
        {secondsLabel(elapsedSeconds)}
        {totalSeconds != null && (
          <span className="text-muted-foreground font-normal"> / {secondsLabel(totalSeconds)}</span>
        )}
      </span>
      <Progress
        value={progressValue}
        className={cn(
          "h-1.5 flex-1",
          timerTone === "warning" && "**:data-[slot=progress-indicator]:bg-warning",
          timerTone === "danger" && "**:data-[slot=progress-indicator]:bg-destructive",
        )}
      />
      <span
        className={cn(
          "shrink-0 text-xs font-medium whitespace-nowrap",
          timerTone === "warning" && "text-warning",
          timerTone === "danger" && "text-destructive",
          timerTone === "default" && "text-muted-foreground",
        )}
      >
        {cueText}
      </span>
    </div>
  );
}

function PreparationTimer({
  enteredAt,
  startedAt,
}: {
  enteredAt: string | null;
  startedAt: string | null;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  const seconds = preparationElapsedSeconds(enteredAt, startedAt, now);
  if (seconds == null) return null;
  return (
    <p className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>{t("presentationPreparationTime")}</span>
      <span className="font-mono tabular-nums">{secondsLabel(seconds)}</span>
    </p>
  );
}
