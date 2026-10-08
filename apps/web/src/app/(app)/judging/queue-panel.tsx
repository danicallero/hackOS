"use client";

// The room's left column (H29-H35): stats, the door queue, the waiting list,
// and the per-entry actions. Split out of page.tsx; page.tsx still owns the
// data and passes it down.

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowLineUpIcon } from "@phosphor-icons/react/dist/csr/ArrowLineUp";
import { DoorOpenIcon } from "@phosphor-icons/react/dist/csr/DoorOpen";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { ListNumbersIcon } from "@phosphor-icons/react/dist/csr/ListNumbers";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { SkipForwardIcon } from "@phosphor-icons/react/dist/csr/SkipForward";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import { type ReactNode, useEffect, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Surface } from "@/components/ui/surface";
import { useLocale } from "@/lib/i18n";
import { hasWaitedTooLong } from "@/lib/judging-workspace";
import type {
  ChallengeProgress,
  QueueEntry,
  QueueSearchResult,
  RoomPace,
  RoomView,
} from "@/lib/queue";
import { cn } from "@/lib/utils";
import { entryLabel } from "./helpers";
import { JudgingEmptyState } from "./judging-empty-state";
import { TeamSearch } from "./team-search";

export function QueueStatsCard({
  progress,
  pace,
  timingAction,
}: {
  progress: ChallengeProgress | null;
  pace: RoomPace | null;
  timingAction?: ReactNode;
}) {
  const { t } = useLocale();
  // H29: refresh only the legacy ETA fallback; authoritative projections come from pace.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const total = progress
    ? progress.waiting +
      progress.called +
      progress.inProgress +
      progress.evaluated +
      progress.disqualified +
      progress.other
    : 0;
  const estFinishLabel = pace?.estimatedFinishAt
    ? new Date(pace.estimatedFinishAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : pace && pace.pendingCount > 0
      ? new Date(
          now +
            (pace.pendingCount / pace.roomCount) *
              (pace.estimatedCycleMinutes ?? pace.desiredMinutesPerTeam) *
              60_000,
        ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "—";
  return (
    <div className="space-y-4 px-5 pt-5 pb-4">
      <dl className="grid grid-cols-2 gap-4">
        <div>
          <dt className="type-meta">{t("queueStatsEvaluated")}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {progress ? `${progress.evaluated} / ${total}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="type-meta">{t("queueStatsAvgTime")}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {progress?.avgEvaluationMinutes != null
              ? t("queueStatsMinutes", { count: Math.round(progress.avgEvaluationMinutes) })
              : "—"}
          </dd>
        </div>
      </dl>
      <div className="space-y-3 border-t border-border pt-4">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="type-meta">{t("queueStatsEstFinish")}</dt>
            <dd
              className={cn(
                "mt-1 text-lg font-semibold tabular-nums",
                pace?.exceedsJudgingClose && "text-destructive",
              )}
            >
              {estFinishLabel}
            </dd>
          </div>
          <div>
            <dt className="type-meta">{t("judgingCloseLabel")}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">
              {pace?.judgingClosesAt
                ? new Date(pace.judgingClosesAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </dd>
          </div>
        </dl>
        {pace?.exceedsJudgingClose && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <WarningIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t("judgingEstimatedOverrun")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div>
          <p className="type-meta">{t("queueStatsPacingTarget")}</p>
          <p
            className={cn(
              "mt-1 text-lg font-semibold tabular-nums",
              pace?.autoAdjusted && "text-warning",
            )}
          >
            {pace
              ? t("queueStatsMinutes", { count: Math.round(pace.effectiveMinutesPerTeam) })
              : "—"}
          </p>
          {pace?.autoAdjusted && (
            <p className="text-warning text-xs">{t("queueStatsAdjustedHint")}</p>
          )}
        </div>
        {timingAction}
      </div>
    </div>
  );
}

export function QueuePanel({
  timingAction,
  view,
  progress,
  pace,
  canOperate,
  canJudge,
  canAdmin,
  busy,
  query,
  results,
  searching,
  searchDisabled,
  onQuery,
  onManualCall,
  onEntryAction,
  onMoveToPosition,
  onAddTop,
  onAddWaiting,
  onReEnter,
  onOpenReview,
}: {
  timingAction?: ReactNode;
  view: RoomView;
  progress: ChallengeProgress | null;
  pace: RoomPace | null;
  canOperate: boolean;
  canJudge: boolean;
  canAdmin: boolean;
  busy: string | null;
  query: string;
  results: QueueSearchResult[];
  searching: boolean;
  searchDisabled: boolean;
  onQuery: (value: string) => void;
  onManualCall: (entry: QueueEntry, targetStatus: "called" | "in_room") => void;
  onEntryAction: (
    entry: QueueEntry,
    action: "notify-enter" | "bring-in" | "requeue" | "no-show" | "skip" | "disqualify",
    body: Record<string, unknown> | undefined,
    label: string,
  ) => void;
  onMoveToPosition: (entry: QueueEntry, position: number) => void;
  onAddTop: (entry: QueueSearchResult) => void;
  onAddWaiting: (entry: QueueSearchResult) => void;
  onReEnter: (entry: QueueSearchResult, position: "top" | "bottom") => void;
  onOpenReview: (entry: QueueSearchResult) => void;
}) {
  const { t } = useLocale();
  const [searchOpen, setSearchOpen] = useState(false);
  const waitingEntries = view.next;
  const calledEntries = view.called;
  const blockedByEntry = new Map((view.crossRoomSkips ?? []).map((skip) => [skip.entryId, skip]));
  const trimmed = query.trim();

  return (
    <Surface padding="none" className="flex h-full min-h-0 flex-col overflow-hidden">
      <QueueStatsCard progress={progress} pace={pace} timingAction={timingAction} />
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 scrollbar-none [&::-webkit-scrollbar]:hidden">
        <QueueList
          title={t("waitingRoomCount", { count: calledEntries.length })}
          entries={calledEntries}
          empty={t("noTeamsWaitingDoor")}
          emptyIcon={DoorOpenIcon}
          compact
          desiredMinutesPerTeam={pace?.desiredMinutesPerTeam ?? null}
          calledTooLongThresholdMinutes={pace?.calledTooLongThresholdMinutes ?? null}
          renderActions={(entry) => (
            <CalledEntryActions
              entry={entry}
              busy={busy}
              canJudge={canJudge}
              canOperate={canOperate}
              canAdmin={canAdmin}
              onEntryAction={onEntryAction}
              onMoveToPosition={onMoveToPosition}
            />
          )}
        />

        <Separator />

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                {t("challengeQueueCount", { count: waitingEntries.length })}
              </h3>
            </div>
            <Button
              size="icon"
              variant={searchOpen ? "secondary" : "ghost"}
              aria-label={t("searchTeamsAria")}
              aria-expanded={searchOpen}
              aria-controls="judging-team-search-panel"
              disabled={searchDisabled}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <MagnifyingGlassIcon aria-hidden="true" className="size-4" />
            </Button>
          </div>

          {searchOpen && (
            <div id="judging-team-search-panel">
              <TeamSearch
                query={query}
                results={results}
                searching={searching}
                trimmed={trimmed}
                busy={busy}
                canOperate={canOperate}
                canJudge={canJudge}
                onOpenReview={onOpenReview}
                onQuery={onQuery}
                onAddTop={onAddTop}
                onAddWaiting={onAddWaiting}
                onReEnter={onReEnter}
                onBringIn={(entry) => onManualCall(entry, "in_room")}
              />
            </div>
          )}

          <QueueList
            title=""
            entries={waitingEntries}
            empty={t("noTeamsChallengeQueue")}
            emptyIcon={ListNumbersIcon}
            className="min-h-0 flex-1"
            emptyClassName="min-h-0 flex-1"
            desiredMinutesPerTeam={pace?.desiredMinutesPerTeam ?? null}
            calledTooLongThresholdMinutes={pace?.calledTooLongThresholdMinutes ?? null}
            renderActions={(entry) => {
              const blocked = blockedByEntry.get(entry.id);
              return (
                <div className="flex w-full flex-col gap-2">
                  {blocked ? (
                    <p className="text-warning text-pretty text-xs" role="status">
                      {t("teamBusyInOtherRoom", { room: blocked.blockingRoomName })}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy != null || !canOperate || Boolean(blocked)}
                      onClick={() => onManualCall(entry, "called")}
                      loading={busy === `manual-${entry.id}`}
                      className="flex-1"
                    >
                      {t("call")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy != null || (!canOperate && !canJudge)}
                      loading={busy === `skip-${entry.id}`}
                      onClick={() =>
                        onEntryAction(
                          entry,
                          "skip",
                          { reason: "Skipped by operator" },
                          t("teamSkipped"),
                        )
                      }
                    >
                      <SkipForwardIcon aria-hidden="true" className="size-4" />
                      {t("skip")}
                    </Button>
                  </div>
                </div>
              );
            }}
          />
        </div>
      </div>
    </Surface>
  );
}

/**
 * Actions for a team at the door: Call in / Bring in / a "More" menu for the
 * rarer moves (requeue, no-show, disqualify). The three buttons flex-wrap so
 * "More actions" sits next to Bring in when the column is wide enough, and
 * drops to its own row when it isn't, instead of five separate buttons.
 */
export function CalledEntryActions({
  entry,
  busy,
  canJudge,
  canOperate,
  canAdmin,
  onEntryAction,
  onMoveToPosition,
}: {
  entry: QueueEntry;
  busy: string | null;
  canJudge: boolean;
  canOperate: boolean;
  canAdmin: boolean;
  onEntryAction: (
    entry: QueueEntry,
    action: "notify-enter" | "bring-in" | "requeue" | "no-show" | "skip" | "disqualify",
    body: Record<string, unknown> | undefined,
    label: string,
  ) => void;
  onMoveToPosition: (entry: QueueEntry, position: number) => void;
}) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState<"no-show" | "disqualify" | null>(null);
  const [positionOpen, setPositionOpen] = useState(false);
  const [position, setPosition] = useState(String(entry.position ?? 1));
  const canModerate = !canJudge && !canOperate;
  const requestedPosition = Number(position);
  const validPosition = Number.isInteger(requestedPosition) && requestedPosition >= 1;

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        className="min-w-28 flex-1"
        disabled={busy != null || canModerate}
        onClick={() => onEntryAction(entry, "notify-enter", undefined, t("entranceNoticeSent"))}
        loading={busy === `notify-enter-${entry.id}`}
      >
        <PaperPlaneTiltIcon aria-hidden="true" className="size-4" />
        {t("callIn")}
      </Button>
      <Button
        size="sm"
        className="min-w-28 flex-1"
        disabled={busy != null || !canJudge}
        onClick={() => onEntryAction(entry, "bring-in", undefined, t("teamBroughtInShort"))}
        loading={busy === `bring-in-${entry.id}`}
      >
        <DoorOpenIcon aria-hidden="true" className="size-4" />
        {t("bringIn")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="min-w-28 flex-1"
            disabled={busy != null || canModerate}
          >
            <DotsThreeIcon aria-hidden="true" className="size-4" />
            {t("moreActions")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() =>
              onEntryAction(
                entry,
                "requeue",
                { position: "top", reason: "Returned to top of queue" },
                t("teamReturnedQueue"),
              )
            }
          >
            <ArrowLineUpIcon aria-hidden="true" className="size-4" />
            {t("requeueTop")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              onEntryAction(
                entry,
                "requeue",
                { position: "bottom", reason: "Returned from waiting room" },
                t("teamReturnedQueue"),
              )
            }
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" className="size-4" />
            {t("requeueBottom")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setPosition(String(entry.position ?? 1));
              setPositionOpen(true);
            }}
          >
            <ListNumbersIcon aria-hidden="true" className="size-4" />
            {t("queueMoveToPosition")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming("no-show")}>
            <WarningIcon aria-hidden="true" className="size-4" />
            {t("noShow")}
          </DropdownMenuItem>
          {canAdmin && (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming("disqualify")}>
              {t("disqualify")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Modal
        open={positionOpen}
        onOpenChange={setPositionOpen}
        title={t("queueMoveToPosition")}
        description={t("queueMoveToPositionDescription")}
        icon={ListNumbersIcon}
        footer={
          <>
            <Button variant="outline" onClick={() => setPositionOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={busy != null || canModerate || !validPosition}
              loading={busy === `move-position-${entry.id}`}
              onClick={() => {
                onMoveToPosition(entry, requestedPosition);
                setPositionOpen(false);
              }}
            >
              {t("queueMoveToPosition")}
            </Button>
          </>
        }
      >
        <div className="space-y-2 py-1">
          <Label htmlFor={`queue-position-${entry.id}`}>{t("position")}</Label>
          <Input
            id={`queue-position-${entry.id}`}
            type="number"
            min={1}
            step={1}
            value={position}
            onChange={(event) => setPosition(event.target.value)}
          />
        </div>
      </Modal>
      <AlertModal
        open={confirming === "no-show"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("confirmNoShowTitle")}
        description={t("confirmNoShowDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={t("noShow")}
        destructive
        autoClose
        onConfirm={() =>
          onEntryAction(entry, "no-show", { reason: "No show" }, t("noShowRecorded"))
        }
      />
      {canAdmin && (
        <AlertModal
          open={confirming === "disqualify"}
          onOpenChange={(open) => !open && setConfirming(null)}
          title={t("confirmDisqualifyTitle")}
          description={t("confirmDisqualifyDescription")}
          cancelLabel={t("cancel")}
          confirmLabel={t("disqualify")}
          destructive
          autoClose
          onConfirm={() =>
            onEntryAction(
              entry,
              "disqualify",
              { reason: "Repeated no-show" },
              t("teamDisqualified"),
            )
          }
        />
      )}
    </div>
  );
}

export function QueueList({
  title,
  entries,
  empty,
  emptyIcon: EmptyIcon,
  emptyClassName,
  className,
  compact,
  desiredMinutesPerTeam,
  calledTooLongThresholdMinutes,
  renderActions,
}: {
  title: string;
  entries: QueueEntry[];
  empty: string;
  emptyIcon?: PhosphorIcon;
  emptyClassName?: string;
  className?: string;
  compact?: boolean;
  desiredMinutesPerTeam?: number | null;
  calledTooLongThresholdMinutes?: number | null;
  renderActions: (entry: QueueEntry) => React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {entries.length === 0 ? (
        <JudgingEmptyState
          className={emptyClassName}
          icon={EmptyIcon ?? ListNumbersIcon}
          title={empty}
        />
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, index) => (
            <li key={entry.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("truncate font-medium", compact ? "text-sm" : "text-xs")}>
                    {!compact && `#${entry.position ?? index + 1} `}
                    {entryLabel(entry, t)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {entry.call_count > 0 && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t("pastCalls")} {entry.call_count}
                      </span>
                    )}
                    {entry.position != null && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {t("positionHash", { position: entry.position })}
                      </span>
                    )}
                    {entry.called_at && (
                      <span
                        className={cn(
                          "text-muted-foreground text-xs tabular-nums",
                          hasWaitedTooLong(
                            entry.called_at,
                            desiredMinutesPerTeam ?? null,
                            calledTooLongThresholdMinutes ?? null,
                          ) && "text-warning",
                        )}
                      >
                        {t("calledAt", {
                          time: new Date(entry.called_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        })}
                        {hasWaitedTooLong(
                          entry.called_at,
                          desiredMinutesPerTeam ?? null,
                          calledTooLongThresholdMinutes ?? null,
                        ) && ` · ${t("calledTooLong")}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{renderActions(entry)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
