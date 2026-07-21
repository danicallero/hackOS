"use client";

// The room's left column (H29-H35): stats, the door queue, the waiting list,
// and the per-entry actions. Split out of page.tsx; page.tsx still owns the
// data and passes it down.

import {
  AlertTriangleIcon,
  ArrowUpToLineIcon,
  DoorOpenIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SkipForwardIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
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
import { ConfirmAction } from "./confirm-action";
import { entryLabel } from "./helpers";
import { TeamSearch } from "./team-search";

export function QueueStatsCard({
  progress,
  pace,
}: {
  progress: ChallengeProgress | null;
  pace: RoomPace | null;
}) {
  const { t } = useLocale();
  const total = progress
    ? progress.waiting +
      progress.called +
      progress.inProgress +
      progress.evaluated +
      progress.disqualified +
      progress.other
    : 0;
  // Pending teams are split across every room sharing this challenge's queue.
  const estFinishLabel =
    pace && pace.pendingCount > 0
      ? new Date(
          Date.now() + (pace.pendingCount / pace.roomCount) * pace.effectiveMinutesPerTeam * 60_000,
        ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "—";

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-5 pt-5 pb-4">
      <div>
        <p className="text-muted-foreground text-xs font-semibold uppercase">
          {t("queueStatsEvaluated")}
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums">
          {progress ? `${progress.evaluated} / ${total}` : "—"}
        </p>
      </div>
      <div>
        <p className="text-muted-foreground text-xs font-semibold uppercase">
          {t("queueStatsAvgTime")}
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums">
          {progress?.avgEvaluationMinutes != null
            ? t("queueStatsMinutes", { count: Math.round(progress.avgEvaluationMinutes) })
            : "—"}
        </p>
      </div>
      <div>
        <p className="text-muted-foreground text-xs font-semibold uppercase">
          {t("queueStatsEstFinish")}
        </p>
        <p className="mt-0.5 text-lg font-semibold tabular-nums">{estFinishLabel}</p>
      </div>
      <div>
        <p className="text-muted-foreground text-xs font-semibold uppercase">
          {t("queueStatsPacingTarget")}
        </p>
        <p
          className={cn(
            "mt-0.5 text-lg font-semibold tabular-nums",
            pace?.autoAdjusted && "text-amber-600 dark:text-amber-500",
          )}
        >
          {pace ? t("queueStatsMinutes", { count: Math.round(pace.effectiveMinutesPerTeam) }) : "—"}
        </p>
        {pace?.autoAdjusted && (
          <p className="text-xs text-amber-600 dark:text-amber-500">
            {t("queueStatsAdjustedHint")}
          </p>
        )}
      </div>
    </div>
  );
}

export function QueuePanel({
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
  onAddTop,
  onAddWaiting,
  onReEnter,
  onOpenReview,
}: {
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
    <Card className="gap-0 overflow-hidden p-0">
      <QueueStatsCard progress={progress} pace={pace} />
      <Separator />
      <div className="space-y-5 p-5">
        {view.state?.is_paused && (
          <div
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            {t("roomPausedQueueBehavior")}
          </div>
        )}
        <QueueList
          title={t("waitingRoomCount", { count: calledEntries.length })}
          entries={calledEntries}
          empty={t("noTeamsWaitingDoor")}
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
            />
          )}
        />

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                {t("challengeQueueCount", { count: waitingEntries.length })}
              </h3>
              <p className="text-muted-foreground text-xs">{t("upcomingTeamsRoom")}</p>
              <p className="text-muted-foreground text-pretty text-xs">
                {t("crossRoomSkipPositionPreserved")}
              </p>
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
              <SearchIcon className="size-4" />
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
            scroll
            desiredMinutesPerTeam={pace?.desiredMinutesPerTeam ?? null}
            calledTooLongThresholdMinutes={pace?.calledTooLongThresholdMinutes ?? null}
            renderActions={(entry) => {
              const blocked = blockedByEntry.get(entry.id);
              return (
                <div className="flex w-full flex-col gap-2">
                  {blocked ? (
                    <p
                      className="text-pretty text-xs text-amber-700 dark:text-amber-300"
                      role="status"
                    >
                      {t("teamBusyInOtherRoom", { room: blocked.blockingRoomName })}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy != null || !canOperate || Boolean(blocked)}
                      onClick={() => onManualCall(entry, "called")}
                      className="flex-1"
                    >
                      {t("call")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy != null || !canOperate}
                      onClick={() =>
                        onEntryAction(
                          entry,
                          "skip",
                          { reason: "Skipped by operator" },
                          t("teamSkipped"),
                        )
                      }
                    >
                      <SkipForwardIcon className="size-4" />
                      {t("skip")}
                    </Button>
                  </div>
                </div>
              );
            }}
          />
        </div>
      </div>
    </Card>
  );
}

/**
 * Actions for a team at the door, compacted to two button rows: a primary
 * row (Call in / Bring in) and a "More" menu for the rarer moves (requeue,
 * no-show, disqualify) instead of five separate buttons wrapping across
 * three rows in the 360px sidebar.
 */
export function CalledEntryActions({
  entry,
  busy,
  canJudge,
  canOperate,
  canAdmin,
  onEntryAction,
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
}) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState<"no-show" | "disqualify" | null>(null);
  const canModerate = !canJudge && !canOperate;

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy != null || canModerate}
        onClick={() => onEntryAction(entry, "notify-enter", undefined, t("entranceNoticeSent"))}
      >
        <SendIcon className="size-4" />
        {t("callIn")}
      </Button>
      <Button
        size="sm"
        disabled={busy != null || !canJudge}
        onClick={() => onEntryAction(entry, "bring-in", undefined, t("teamBroughtInShort"))}
      >
        <DoorOpenIcon className="size-4" />
        {t("bringIn")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="col-span-2"
            disabled={busy != null || canModerate}
          >
            <MoreHorizontalIcon className="size-4" />
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
            <ArrowUpToLineIcon className="size-4" />
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
            <RotateCcwIcon className="size-4" />
            {t("requeueBottom")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirming("no-show")}>
            <AlertTriangleIcon className="size-4" />
            {t("noShow")}
          </DropdownMenuItem>
          {canAdmin && (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirming("disqualify")}>
              {t("disqualify")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmAction
        open={confirming === "no-show"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={t("confirmNoShowTitle")}
        description={t("confirmNoShowDescription")}
        confirmLabel={t("noShow")}
        destructive
        onConfirm={() =>
          onEntryAction(entry, "no-show", { reason: "No show" }, t("noShowRecorded"))
        }
      />
      {canAdmin && (
        <ConfirmAction
          open={confirming === "disqualify"}
          onOpenChange={(open) => !open && setConfirming(null)}
          title={t("confirmDisqualifyTitle")}
          description={t("confirmDisqualifyDescription")}
          confirmLabel={t("disqualify")}
          destructive
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
  compact,
  scroll,
  desiredMinutesPerTeam,
  calledTooLongThresholdMinutes,
  renderActions,
}: {
  title: string;
  entries: QueueEntry[];
  empty: string;
  compact?: boolean;
  scroll?: boolean;
  desiredMinutesPerTeam?: number | null;
  calledTooLongThresholdMinutes?: number | null;
  renderActions: (entry: QueueEntry) => React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <div className="space-y-3">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {entries.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
          {empty}
        </p>
      ) : (
        <ul className={cn("space-y-2", scroll && "max-h-96 overflow-y-auto pr-1")}>
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
                          ) && "text-amber-700 dark:text-amber-400",
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
