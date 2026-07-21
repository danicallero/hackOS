"use client";

// The room's right column (H36-H39): who is presenting, their project, and
// the presentation clock.

import {
  DoorOpenIcon,
  ExternalLinkIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { StatusBadge } from "@/components/common/status-badge";
import { ProjectDescription } from "@/components/projects/project-description";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useLocale } from "@/lib/i18n";
import { freezeTotalMinutes, presentationTimerState } from "@/lib/judging-workspace";
import { getRepoChallenges, type QueueEntry, type RepoChallenge, type RoomPace } from "@/lib/queue";
import { cn } from "@/lib/utils";
import type { Challenge } from "../challenges/shared";
import { ConfirmAction } from "./confirm-action";
import { challengeName, entryLabel, secondsLabel } from "./helpers";

export function PresentationPanel({
  entry,
  challenge,
  pace,
  waitingRoomCount,
  nextWaitingEntry,
  firstCalledEntry,
  canJudge,
  canOperate,
  busy,
  onEntryAction,
  onManualCall,
}: {
  entry: QueueEntry | null;
  challenge: Challenge | null;
  pace: RoomPace | null;
  waitingRoomCount: number;
  /** Front of the challenge queue (status `waiting`) — powers the "call next" shortcut. */
  nextWaitingEntry: QueueEntry | null;
  /** Front of the waiting room (status `called`) — powers the "bring in next" shortcut. */
  firstCalledEntry: QueueEntry | null;
  canJudge: boolean;
  canOperate: boolean;
  busy: string | null;
  onEntryAction: (
    entry: QueueEntry,
    action: "start" | "complete" | "send-back" | "bring-in",
    body: Record<string, unknown> | undefined,
    label: string,
  ) => void;
  onManualCall: (entry: QueueEntry, targetStatus: "called" | "in_room") => void;
}) {
  const { t } = useLocale();
  const isPresenting = entry?.status === "presenting";
  const isReady = entry?.status === "in_room";
  // H33 (#59): a team that already reached the room or the stage can be sent
  // back to the top of the waiting room. This is a judging decision, so it only
  // lives here in the Judging Panel — never in the Queue Operations view.
  const canSendBack = isPresenting || isReady;

  return (
    <Card className={cn("gap-0 overflow-hidden p-0", entry && "border-primary/30 bg-primary/5")}>
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
          <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed p-6 text-center">
            <DoorOpenIcon className="text-muted-foreground mb-3 size-8" />
            <p className="text-sm font-medium">{t("noPresentationInProgress")}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {waitingRoomCount > 0 ? t("teamsWaitingDoor") : t("callNextTeamPrompt")}
            </p>
            {(nextWaitingEntry || firstCalledEntry) && (
              <div className="mt-4 flex gap-2">
                {nextWaitingEntry && (
                  <Button
                    variant="outline"
                    disabled={!canOperate || busy != null}
                    onClick={() => onManualCall(nextWaitingEntry, "called")}
                  >
                    <SendIcon className="size-4" />
                    {t("callNextTeam")}
                  </Button>
                )}
                {waitingRoomCount > 0 && firstCalledEntry && (
                  <Button
                    disabled={!canJudge || busy != null}
                    onClick={() =>
                      onEntryAction(
                        firstCalledEntry,
                        "bring-in",
                        undefined,
                        t("teamBroughtInShort"),
                      )
                    }
                  >
                    <DoorOpenIcon className="size-4" />
                    {t("bringInNextTeam")}
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <ProjectInfo entry={entry} challenge={challenge} />

            {isPresenting && (
              <PresentationTimer
                startedAt={entry.presentation_started_at}
                totalMinutes={pace?.effectiveMinutesPerTeam ?? null}
              />
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                disabled={!canJudge || !isReady || busy != null}
                onClick={() => onEntryAction(entry, "start", undefined, t("presentationStarted"))}
              >
                <PlayIcon className="size-4" />
                {t("start")}
              </Button>
              {canSendBack && (
                <ConfirmAction
                  title={t("confirmSendBackTitle")}
                  description={t("confirmSendBackDescription")}
                  confirmLabel={t("requeueWaitingRoom")}
                  onConfirm={() =>
                    onEntryAction(
                      entry,
                      "send-back",
                      { reason: "Re-queued to waiting room" },
                      t("teamSentBackWaiting"),
                    )
                  }
                  trigger={
                    <Button variant="outline" disabled={!canJudge || busy != null}>
                      <RotateCcwIcon className="size-4" />
                      {t("requeueWaitingRoom")}
                    </Button>
                  }
                />
              )}
            </div>
          </>
        )}
      </div>
    </Card>
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
      <div className="rounded-md border bg-background p-3">
        <div className="mb-1 flex items-center gap-2">
          <UsersIcon className="text-muted-foreground size-4" />
          <p className="text-xs font-semibold uppercase">{t("membersLabel")}</p>
        </div>
        <p className="text-sm font-medium text-pretty">
          {members.length > 0
            ? members
                .map(
                  (member) => `${member.name ?? ""} ${member.surname ?? ""}`.trim() || member.email,
                )
                .join(" · ")
            : "—"}
        </p>
      </div>

      {entry.repo_description && (
        <div className="rounded-md border bg-background p-3">
          <p className="mb-1 text-xs font-semibold uppercase">{t("projectLabel")}</p>
          <ProjectDescription text={entry.repo_description} />
        </div>
      )}

      {links.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {links.map((link, i) => (
            <Button key={link.label} variant={i === 0 ? "default" : "outline"} size="sm" asChild>
              <a href={link.href} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="size-4" />
                {link.label}
              </a>
            </Button>
          ))}
        </div>
      )}

      {/* A project can submit to more than one challenge — each has its own
          queue standing, so list every one instead of just this room's. */}
      {(repoChallenges.length > 0 || challenge) && (
        <div className="rounded-md border bg-background p-3">
          <p className="mb-1 text-xs font-semibold uppercase">{t("challengesLabel")}</p>
          <ul className="space-y-1.5">
            {(repoChallenges.length > 0
              ? repoChallenges
              : challenge
                ? [
                    {
                      id: entry.challenge_id,
                      title: challengeName(t, challenge, entry.challenge_id),
                      status: entry.status,
                      room_id: null,
                      room_name: null,
                    },
                  ]
                : []
            ).map((rc) => (
              <li key={rc.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{rc.title}</span>
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
}: {
  startedAt: string | null;
  /** Already capped by the challenge's max and squeezed for remaining time (H39). */
  totalMinutes: number | null;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(Date.now());

  // The total is frozen per presentation so a mid-presentation pace refetch
  // can't shift it; the rule itself lives (and is tested) in
  // judging-workspace.ts.
  const frozen = useRef<{ key: string | null; minutes: number | null }>({
    key: null,
    minutes: null,
  });
  frozen.current = freezeTotalMinutes(frozen.current, startedAt, totalMinutes);
  // Pure arithmetic (elapsed/remaining/progress/tone) lives in
  // judging-workspace.ts so the threshold boundaries are unit-testable; only
  // the per-presentation freeze above and the ticking clock stay here.
  const {
    elapsedSeconds,
    totalSeconds,
    progressValue,
    tone: timerTone,
  } = presentationTimerState(startedAt, frozen.current.minutes, now);
  const cueText =
    timerTone === "danger"
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
          timerTone === "warning" && "text-amber-600 dark:text-amber-400",
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
          timerTone === "warning" && "[&_[data-slot=progress-indicator]]:bg-amber-500",
          timerTone === "danger" && "[&_[data-slot=progress-indicator]]:bg-destructive",
        )}
      />
      <span
        className={cn(
          "shrink-0 text-xs font-medium whitespace-nowrap",
          timerTone === "warning" && "text-amber-600 dark:text-amber-400",
          timerTone === "danger" && "text-destructive",
          timerTone === "default" && "text-muted-foreground",
        )}
      >
        {cueText}
      </span>
    </div>
  );
}
