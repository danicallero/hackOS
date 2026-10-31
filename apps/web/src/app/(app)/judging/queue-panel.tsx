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
import { IconButton } from "@/components/common/icon-button";
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
import { formatEventClock } from "@/lib/datetime";
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

/** Room and queue numbers for the judging top bar: always visible, even in View project. */
export function JudgingStats({
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
    ? formatEventClock(pace.estimatedFinishAt)
    : pace && pace.pendingCount > 0
      ? formatEventClock(
          now +
            (pace.pendingCount / pace.roomCount) *
              (pace.estimatedCycleMinutes ?? pace.desiredMinutesPerTeam) *
              60_000,
        )
      : "—";
  return (
    <div className="order-3 col-span-2 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-x-4 gap-y-3 xl:order-none xl:col-span-1">
      <Stat primary label={t("queueStatsEvaluated")}>
        {progress ? `${progress.evaluated} / ${total}` : "—"}
      </Stat>
      <Stat label={t("queueStatsAvgTime")}>
        {progress?.avgEvaluationMinutes != null
          ? t("queueStatsMinutes", { count: Math.round(progress.avgEvaluationMinutes) })
          : "—"}
      </Stat>
      <Stat
        primary
        label={t("queueStatsEstFinish")}
        className={pace?.exceedsJudgingClose ? "text-destructive" : undefined}
        title={pace?.exceedsJudgingClose ? t("judgingEstimatedOverrun") : undefined}
      >
        {pace?.exceedsJudgingClose && (
          <WarningIcon aria-hidden="true" className="mr-1.5 inline size-5 align-text-bottom" />
        )}
        {estFinishLabel}
      </Stat>
      <Stat label={t("judgingCloseLabel")}>
        {pace?.judgingClosesAt ? formatEventClock(pace.judgingClosesAt) : "—"}
      </Stat>
      <Stat
        label={t("queueStatsPacingTarget")}
        className={pace?.autoAdjusted ? "text-warning" : undefined}
        title={pace?.autoAdjusted ? t("queueStatsAdjustedHint") : undefined}
        action={timingAction}
      >
        {pace ? t("queueStatsMinutes", { count: Math.round(pace.effectiveMinutesPerTeam) }) : "—"}
      </Stat>
    </div>
  );
}

function Stat({
  label,
  primary = false,
  className,
  title,
  action,
  children,
}: {
  label: string;
  /** The numbers a judge watches; the rest sit quietly beside them. */
  primary?: boolean;
  className?: string;
  title?: string;
  /** A control for the value itself, such as an edit pencil. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <dl title={title}>
      <dt className="text-muted-foreground text-xs font-medium whitespace-nowrap">{label}</dt>
      <dd className="flex items-center gap-1">
        <span
          className={cn(
            "tabular-nums whitespace-nowrap",
            primary ? "text-lg font-semibold" : "text-muted-foreground text-sm font-medium",
            className,
          )}
        >
          {children}
        </span>
        {action}
      </dd>
    </dl>
  );
}

export function QueuePanel({
  view,
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
  view: RoomView;
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
              <h2 className="text-sm font-semibold">
                {t("challengeQueueCount", { count: waitingEntries.length })}
              </h2>
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
                      {blocked.reason === "ineligible"
                        ? t("projectIneligible")
                        : t("teamBusyInOtherRoom", { room: blocked.blockingRoomName })}
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
 * Actions for a team at the door: Notify / Bring in / a round "More" menu for the
 * rarer moves (requeue, no-show, disqualify), all in one row of buttons.
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
    <div className="flex w-full items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="min-w-0 flex-1"
        disabled={busy != null || canModerate}
        onClick={() => onEntryAction(entry, "notify-enter", undefined, t("entranceNoticeSent"))}
        loading={busy === `notify-enter-${entry.id}`}
      >
        <PaperPlaneTiltIcon aria-hidden="true" className="size-4" />
        {t("callIn")}
      </Button>
      <Button
        size="sm"
        className="min-w-0 flex-1"
        disabled={busy != null || !canJudge}
        onClick={() => onEntryAction(entry, "bring-in", undefined, t("teamBroughtInShort"))}
        loading={busy === `bring-in-${entry.id}`}
      >
        <DoorOpenIcon aria-hidden="true" className="size-4" />
        {t("bringIn")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t("moreActions")}
            title={t("moreActions")}
            size="icon-sm"
            variant="outline"
            className="shrink-0 rounded-full"
            disabled={busy != null || canModerate}
          >
            <DotsThreeIcon aria-hidden="true" className="size-4" />
          </IconButton>
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
      {title && <h2 className="text-sm font-semibold">{title}</h2>}
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
                          time: formatEventClock(entry.called_at),
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
