"use client";

// The room's right column (H36-H39): who is presenting, their project, and
// the presentation clock.

import { projectDescriptionField } from "@hackos/shared/forms";
import { youtubeEmbedUrl } from "@hackos/shared/youtube";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PauseIcon } from "@phosphor-icons/react/dist/csr/Pause";
import { PlayIcon } from "@phosphor-icons/react/dist/csr/Play";
import { useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { QueueStatusDot } from "@/components/common/queue-status-badge";
import { StatusBadge } from "@/components/common/status-badge";
import { useProjectGithubActivity } from "@/components/projects/github-activity";
import { ProjectAnswers } from "@/components/projects/project-answers";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Surface } from "@/components/ui/surface";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { API_URL } from "@/lib/env";
import { externalUrlHref } from "@/lib/external-url";
import { useLocale } from "@/lib/i18n";
import {
  canTransition,
  preparationElapsedSeconds,
  presentationTimerState,
} from "@/lib/judging-workspace";
import type { NativeProject } from "@/lib/native-projects";
import { projectSummary } from "@/lib/project-text";
import { getRepoChallenges, type QueueEntry } from "@/lib/queue";
import { cn } from "@/lib/utils";
import type { Challenge } from "../challenges/shared";
import { challengeName, entryLabel, secondsLabel } from "./helpers";
import { JudgingEmptyState } from "./judging-empty-state";

/** Opens the link in a new tab, then lets the evaluation window follow so it ends up in front. */
function openProjectLink(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string,
  onExternalOpen?: () => void,
) {
  if (!onExternalOpen) return;
  event.preventDefault();
  window.open(href, "_blank", "noopener,noreferrer");
  onExternalOpen();
}

export function PresentationPanel({
  entry,
  challenge,
  waitingRoomCount,
  firstCalledEntry,
  canJudge,
  canOperate,
  busy,
  preparationSeconds,
  presentationSeconds,
  detailsOpen,
  onExternalOpen,
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
  /** Track's configured preparation allowance; null until loaded. */
  preparationSeconds: number | null;
  /** Track's maximum presentation time; null until loaded. */
  presentationSeconds: number | null;
  detailsOpen?: boolean;
  /** Fired when a link leaves for another tab, so the evaluation can follow in its own window. */
  onExternalOpen?: () => void;
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
      className={cn(
        "flex min-h-0 flex-col overflow-hidden xl:h-full",
        entry && "border-primary/30",
      )}
    >
      {entry ? (
        <div className="shrink-0 space-y-3 border-b px-4 py-4">
          <div className="flex min-h-8 items-center justify-between gap-3">
            <h2 className="type-section-title truncate">{entryLabel(entry, t)}</h2>
            <Button variant="outline" size="xs" asChild>
              <a
                href={`/projects/${entry.repo_id}`}
                target="_blank"
                rel="noreferrer"
                onClick={(event) =>
                  openProjectLink(event, `/projects/${entry.repo_id}`, onExternalOpen)
                }
              >
                <ArrowSquareOutIcon aria-hidden="true" />
                {t("openProject")}
              </a>
            </Button>
          </div>
          <div className="space-y-1">
            {(isReady || isPresenting) && (
              <PreparationTimer
                enteredAt={entry.room_entered_at ?? null}
                startedAt={entry.presentation_started_at}
                scheduledSeconds={preparationSeconds}
              />
            )}

            {isReady && presentationSeconds != null && (
              <PresentationTimer startedAt={null} totalMinutes={presentationSeconds / 60} />
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
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-2">
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
        </div>
      ) : (
        <>
          <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <h2 className="type-section-title truncate">{t("waitingForNextTeam")}</h2>
              <p className="text-muted-foreground text-sm">{t("bringTeamPrompt")}</p>
            </div>
            <StatusBadge tone="neutral">{t("idle")}</StatusBadge>
          </div>
          <Separator />
        </>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
          <ProjectInfo
            entry={entry}
            challenge={challenge}
            detailsOpen={detailsOpen}
            onExternalOpen={onExternalOpen}
          />
        )}
      </div>
    </Surface>
  );
}

export function ProjectInfo({
  entry,
  challenge,
  detailsOpen = false,
  onExternalOpen,
}: {
  entry: QueueEntry;
  challenge: Challenge | null;
  /** Project view shows the project details unfolded. */
  detailsOpen?: boolean;
  onExternalOpen?: () => void;
}) {
  const { t, language } = useLocale();
  const members = entry.repo_members ?? [];
  const resource = useServerResource(
    ["judging-project", entry.repo_id],
    async (signal) => {
      const [project, challenges] = await Promise.all([
        api.get<NativeProject>(`/api/repos/${entry.repo_id}`, { signal }),
        getRepoChallenges(entry.repo_id),
      ]);
      return { project, challenges };
    },
    { enabled: Boolean(entry.repo_id) },
  );
  const repoChallenges = resource.data?.challenges ?? [];
  const project = resource.data?.project;
  // Every URL answer (judging links, URL-validated text) joins one row of links and
  // leaves the details, so each link appears exactly once. A YouTube video is already
  // embedded in the details, so it is never a link.
  const urlFields = (project?.template ?? []).flatMap((field) => {
    const isUrlField =
      !field.project_video && (field.judging_link || field.validation?.text_condition === "url");
    const href = isUrlField ? externalUrlHref(String(project?.responses[field.key] ?? "")) : null;
    return href && !youtubeEmbedUrl(href)
      ? [{ key: field.key, label: field.label[language ?? "en"] || field.label.en, href }]
      : [];
  });
  const links = [
    { label: "GitHub", href: project?.githubUrl ?? entry.repo_github_url },
    { label: t("projectDemoLink"), href: project?.demoUrl ?? entry.repo_demo_url },
  ]
    .filter(
      (link): link is { label: string; href: string } =>
        Boolean(link.href) && !youtubeEmbedUrl(link.href ?? ""),
    )
    .concat(urlFields)
    .filter((link, i, all) => all.findIndex((other) => other.href === link.href) === i);
  // The summary shows above the details, so collapsed details leave it out; unfolded
  // details are the one place for it. Library answers such as technologies live in the details.
  const descriptionKey = project && projectDescriptionField(project.template)?.key;
  const projectAnswers = project && (
    <ProjectAnswers
      project={project}
      language={language ?? "en"}
      omitFieldKeys={[
        ...urlFields.map((field) => field.key),
        ...(detailsOpen || !descriptionKey ? [] : [descriptionKey]),
      ]}
      omitDescription={!detailsOpen}
      assetUrl={(path) => new URL(path, API_URL).toString()}
    />
  );
  const activity = useProjectGithubActivity(entry.repo_id)?.totals;

  // Every challenge the project is queued in, shared queues included. All the ones that
  // share the room's queue are being judged now, so each reads Now.
  const nowGroup = repoChallenges.find((row) => row.id === entry.challenge_id)?.queue_group_id;
  const isNow = (row: { id: number; queue_group_id?: number | null }) =>
    row.id === entry.challenge_id || (nowGroup != null && row.queue_group_id === nowGroup);
  const queues =
    repoChallenges.length > 0
      ? repoChallenges
      : challenge
        ? [
            {
              id: entry.challenge_id,
              title: challengeName(t, challenge, entry.challenge_id),
              queue_group_id: null,
              status: entry.status,
              room_id: null,
              room_name: null,
            },
          ]
        : [];

  return (
    <div className="space-y-5">
      {Boolean(resource.error) && (
        <ContextualError
          message={apiErrorText(resource.error, t, t("couldNotLoadProject"))}
          onRetry={resource.reload}
        />
      )}
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
        <Fact quiet label={t("membersLabel")}>
          {members.length > 0 ? (
            <ul>
              {members.map((member, index) => (
                <li key={member.email ?? index}>
                  {`${member.name ?? ""} ${member.surname ?? ""}`.trim() || member.email}
                </li>
              ))}
            </ul>
          ) : (
            "—"
          )}
        </Fact>
        {queues.length > 0 && (
          // A project can be in several challenges, in the same shared queue or not.
          // The ones being judged now lead.
          <Fact label={t("presentingFor")} className="sm:col-span-2">
            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {[...queues]
                .sort((a, b) => Number(isNow(b)) - Number(isNow(a)))
                .map((queue) => (
                  <li key={queue.id} className="flex min-w-0 items-baseline justify-between gap-3">
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        isNow(queue) ? "font-semibold" : "text-muted-foreground font-normal",
                      )}
                    >
                      {queue.title}
                    </span>
                    {isNow(queue) ? (
                      <QueueStatusDot label={t("now")} tone="success" />
                    ) : (
                      <QueueStatusDot status={queue.status} />
                    )}
                  </li>
                ))}
            </ul>
          </Fact>
        )}
        {activity && (
          <Fact quiet label={t("githubCommits")}>
            {activity.commits}
          </Fact>
        )}
        {activity && (
          <Fact quiet label={t("githubPullRequests")}>
            {activity.pullRequests}
            {activity.merged > 0 && (
              <span>
                {" "}
                · {activity.merged} {t("githubMerged")}
              </span>
            )}
          </Fact>
        )}
        {links.length > 0 && (
          <div
            className={cn(
              "flex flex-wrap items-end justify-end gap-2",
              !activity && "sm:col-span-3",
            )}
          >
            {links.map((link) => (
              <Button key={link.href} variant="outline" size="sm" asChild>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => openProjectLink(event, link.href, onExternalOpen)}
                >
                  <ArrowSquareOutIcon aria-hidden="true" className="size-4" />
                  {link.label}
                </a>
              </Button>
            ))}
          </div>
        )}
      </div>

      {project && (
        <div className="space-y-4 border-t border-border/60 pt-4">
          {!detailsOpen && project.description && (
            <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground text-pretty">
              {projectSummary(project.description, project.name)}
            </p>
          )}
          {detailsOpen ? (
            projectAnswers
          ) : (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between px-0 has-[>svg:first-child]:pl-0"
                >
                  {t("judgingProjectDetails")}
                  <CaretDownIcon aria-hidden="true" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-4">{projectAnswers}</CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}
    </div>
  );
}

function Fact({
  label,
  quiet = false,
  className,
  children,
}: {
  label: string;
  /** Context a judge rarely needs: regular weight, softer colour. */
  quiet?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <dl className={cn("min-w-0", className)}>
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd
        className={cn(
          "text-sm leading-6 tabular-nums text-pretty",
          quiet ? "text-muted-foreground font-normal" : "font-medium",
        )}
      >
        {children}
      </dd>
    </dl>
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
  // On time is the normal state and stays unspoken; only exceptions get words.
  const cueText = pausedAt
    ? t("presentationTimerPaused")
    : timerTone === "danger"
      ? t("timeLimitExceeded")
      : timerTone === "warning"
        ? t("wrapUp")
        : null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className={cn(
          "font-mono text-xs font-semibold tabular-nums whitespace-nowrap",
          timerTone === "warning" && "text-warning",
          timerTone === "danger" && "text-destructive",
        )}
      >
        {secondsLabel(elapsedSeconds)}
        {totalSeconds != null && (
          <span className="text-muted-foreground font-normal"> / {secondsLabel(totalSeconds)}</span>
        )}
        {cueText && <span className="font-sans font-medium"> · {cueText}</span>}
      </span>
      <Progress
        value={progressValue}
        className={cn(
          "h-1",
          timerTone === "warning" && "**:data-[slot=progress-indicator]:bg-warning",
          timerTone === "danger" && "**:data-[slot=progress-indicator]:bg-destructive",
        )}
      />
    </div>
  );
}

function PreparationTimer({
  enteredAt,
  startedAt,
  scheduledSeconds,
}: {
  enteredAt: string | null;
  startedAt: string | null;
  scheduledSeconds: number | null;
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
      <span
        className={cn(
          "font-mono tabular-nums",
          scheduledSeconds != null && seconds > scheduledSeconds && "text-destructive",
        )}
      >
        {secondsLabel(seconds)}
        {scheduledSeconds != null && (
          <span className="text-muted-foreground"> / {secondsLabel(scheduledSeconds)}</span>
        )}
      </span>
    </p>
  );
}
