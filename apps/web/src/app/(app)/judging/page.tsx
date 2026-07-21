"use client";

// Queue and judging panel (H29-H40). The layout follows the older judging
// panel's room header + left queue + right presentation/review structure, but
// uses this app's shared API wrappers, cards, tabs and form controls.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { Question } from "@hackos/shared/questions";
import {
  AlertTriangleIcon,
  ArrowUpToLineIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  DoorOpenIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LockIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SkipForwardIcon,
  UsersIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { type Answers, normalizeAnswers, QuestionField } from "@/components/common/question-field";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { ProjectDescription } from "@/components/projects/project-description";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useEventSource, useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api } from "@/lib/api";
import { changedFieldsLabel, requiredUnanswered, reviewStatusBadge } from "@/lib/attempt-review";
import { API_URL } from "@/lib/env";
import { type Translate, useLocale } from "@/lib/i18n";
import { collaborationState, hasWaitedTooLong, workspaceAccess } from "@/lib/judging-workspace";
import {
  type AttemptReviewVersion,
  type ChallengeProgress,
  closeSession,
  entryAction,
  exportUrls,
  getChallengeProgress,
  getRepoChallenges,
  getReview,
  getReviewVersions,
  getRoomPace,
  getRoomView,
  getSessions,
  type JudgingSession,
  listRooms,
  openSession,
  pauseRoom,
  type QueueEntry,
  type QueueSearchResult,
  type RepoChallenge,
  type Room,
  type RoomPace,
  type RoomView,
  resumeRoom,
  saveReview,
  searchTeams,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { type Challenge, textForDisplay } from "../challenges/shared";

const EMPTY_PANEL: Question[] = [];

function challengeName(t: Translate, challenge?: Challenge | null, fallback?: number): string {
  return challenge
    ? textForDisplay(challenge.title)
    : fallback
      ? t("challengeFallbackNumber", { id: fallback })
      : "—";
}

function entryLabel(entry: QueueEntry, t: Translate): string {
  return entry.repo_name ?? t("repoNumber", { id: entry.repo_id });
}

function secondsLabel(value: number | null | undefined): string {
  if (value == null) return "—";
  const rounded = Math.floor(value);
  const sign = rounded < 0 ? "-" : "";
  const absolute = Math.abs(rounded);
  const minutes = Math.floor(absolute / 60);
  const seconds = absolute % 60;
  return `${sign}${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function exportHref(path: string): string {
  return `${API_URL}${path}`;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export default function QueuePage() {
  const { can, me } = useSessionContext();
  const { t } = useLocale();
  const { canOperate, canJudge, canAdmin, canExport, canUse } = workspaceAccess({
    operate: can(CAPABILITIES.QUEUE_OPERATE),
    judge: can(CAPABILITIES.JUDGE_PANEL),
    admin: can(CAPABILITIES.QUEUE_ADMIN),
    exportData: can(CAPABILITIES.JUDGING_EXPORT),
    isRoomJudge: me?.isRoomJudge ?? false,
  });

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<QueueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedReviewEntry, setSelectedReviewEntry] = useState<QueueEntry | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeRoomId = roomId ?? rooms[0]?.id ?? null;

  const roomView = useLiveQuery<RoomView>(
    () => (activeRoomId ? getRoomView(activeRoomId) : Promise.resolve(null as never)),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED, EVENTS.QUEUE_NOTIFY_ENTER],
    { enabled: canUse && activeRoomId != null, queryKey: [activeRoomId] },
  );

  const pace = useLiveQuery<RoomPace>(
    () => (activeRoomId ? getRoomPace(activeRoomId) : Promise.resolve(null as never)),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    { enabled: canUse && activeRoomId != null, queryKey: [activeRoomId] },
  );

  // The room judges a single challenge (read-only label in the panel); fall
  // back to whatever a live entry reports so a freshly seeded room still works.
  const effectiveChallengeId =
    roomView.data?.challenge?.id ??
    roomView.data?.active?.challenge_id ??
    roomView.data?.called[0]?.challenge_id ??
    roomView.data?.next[0]?.challenge_id ??
    challenges[0]?.id ??
    null;

  const progress = useLiveQuery<ChallengeProgress>(
    () =>
      effectiveChallengeId
        ? getChallengeProgress(effectiveChallengeId)
        : Promise.resolve(null as never),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    { enabled: canUse && effectiveChallengeId != null, queryKey: [effectiveChallengeId] },
  );

  const activeChallenge = useMemo(
    () => challenges.find((c) => c.id === effectiveChallengeId) ?? null,
    [challenges, effectiveChallengeId],
  );

  const loadRooms = useCallback(async () => {
    if (!canUse) {
      setRoomsLoading(false);
      return;
    }
    setRoomsLoading(true);
    try {
      const [roomRows, challengeRows] = await Promise.all([
        listRooms(),
        api.get<{ challenges: Challenge[] }>("/api/challenges"),
      ]);
      setRooms(roomRows);
      setChallenges(challengeRows.challenges);
      setRoomId((current) => current ?? roomRows[0]?.id ?? null);
    } catch (err) {
      const message = errorMessage(err, t("couldNotLoadQueueSetup"));
      setActionError(message);
      toast.error(message);
    } finally {
      setRoomsLoading(false);
    }
  }, [canUse, t]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const refreshLive = useCallback(async () => {
    await Promise.all([roomView.refetch(), pace.refetch(), progress.refetch()]);
  }, [roomView, pace, progress]);

  const mutate = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string) => {
      setBusy(key);
      setActionError(null);
      try {
        await action();
        toast.success(success);
        await refreshLive();
      } catch (err) {
        const message = errorMessage(err, t("queueActionFailed"));
        setActionError(message);
        toast.error(message);
      } finally {
        setBusy(null);
      }
    },
    [refreshLive, t],
  );

  // Shared by the queue panel's per-entry actions and the empty-room
  // "call next" / "bring in next" shortcuts on the presentation panel.
  const handleManualCall = useCallback(
    (entry: QueueEntry, targetStatus: "called" | "in_room") =>
      activeRoomId &&
      mutate(
        `manual-${entry.id}`,
        () =>
          entryAction(
            entry.id,
            "manual-call",
            { targetStatus, roomId: activeRoomId, reason: "Manual queue selection" },
            crypto.randomUUID(),
          ),
        targetStatus === "in_room" ? t("teamBroughtIn") : t("teamCalled"),
      ),
    [activeRoomId, mutate, t],
  );

  // H37 search-as-you-type: debounce the query and refresh results as the
  // operator types. An empty query clears the list.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roomView.data changes after each SSE-backed room refresh and intentionally refreshes open search eligibility.
  useEffect(() => {
    const term = search.trim();
    if (!effectiveChallengeId || !term) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const hits = await searchTeams(effectiveChallengeId, term);
        if (!cancelled) setSearchResults(hits);
      } catch (err) {
        if (!cancelled) {
          const message = errorMessage(err, t("searchFailed"));
          setActionError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [effectiveChallengeId, roomView.data, search, t]);

  if (!canUse) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("judging")} />
        <EmptyState
          icon={LockIcon}
          title={t("noAccessJudgingPanel")}
          description={t("judgingAccessDeniedDesc")}
        />
      </div>
    );
  }

  const view = roomView.data;
  const active = view?.active ?? null;
  const state = view?.state ?? null;
  const isPaused = state?.is_paused ?? view?.room.status === "paused";
  const challengeLabel =
    view?.challenge?.title ?? (activeChallenge ? challengeName(t, activeChallenge) : "—");

  return (
    // App-like layout: the room selector pins to the top, the queue panel stays
    // put on the left, and only the right column (project + scoring) scrolls.
    // At xl we clamp the whole page to the viewport (100dvh minus the app chrome:
    // 3.5rem header + 2rem+2rem main py-8) so the outer page never scrolls.
    <div className="flex flex-col gap-5 xl:h-[calc(100dvh-7.5rem)]" data-wide>
      <Card className="gap-0 p-5">
        {/* Fluid header (H29, issue #61): the two field columns grow/shrink and
            the action cluster drops to its own row under tight widths (tiling
            WMs, tablet/mobile) instead of overflowing the card. No fixed track
            widths — flex-basis + min-width + flex-wrap handle the reflow. */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[11rem] flex-1 space-y-2">
            <Label htmlFor="queue-room">{t("roomLabel")}</Label>
            <Select
              value={activeRoomId ? String(activeRoomId) : ""}
              onValueChange={(value) => {
                setRoomId(Number(value));
                setSelectedReviewEntry(null);
              }}
              disabled={roomsLoading || rooms.length === 0}
            >
              <SelectTrigger id="queue-room" className="w-full">
                <SelectValue placeholder={t("selectRoomPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={String(room.id)}>
                    {room.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* A room judges exactly one challenge — informational, read-only.
              Change it from the room admin surface, not here. */}
          <div className="min-w-[11rem] flex-[1.2] space-y-2">
            <Label>{t("challengeLabel")}</Label>
            <div className="border-input bg-muted/40 text-muted-foreground flex h-9 w-full min-w-0 items-center gap-2 rounded-md border px-3 text-sm">
              <LockIcon className="size-3.5 shrink-0" />
              <span className="text-foreground truncate font-medium">{challengeLabel}</span>
            </div>
          </div>

          <div className="flex flex-1 flex-wrap items-end gap-2 sm:justify-end">
            {isPaused ? (
              <Button
                disabled={!activeRoomId || busy === "pause" || (!canOperate && !canJudge)}
                onClick={() =>
                  activeRoomId &&
                  mutate(
                    "pause",
                    () => resumeRoom(activeRoomId, crypto.randomUUID()),
                    t("roomResumed"),
                  )
                }
              >
                <PlayIcon className="size-4" />
                {t("resume")}
              </Button>
            ) : (
              <ConfirmAction
                title={t("pauseRoomTitle")}
                description={t("pauseRoomDescription")}
                confirmLabel={t("pause")}
                onConfirm={() =>
                  activeRoomId &&
                  mutate(
                    "pause",
                    () => pauseRoom(activeRoomId, crypto.randomUUID()),
                    t("roomPaused"),
                  )
                }
                trigger={
                  <Button
                    variant="outline"
                    disabled={!activeRoomId || busy === "pause" || (!canOperate && !canJudge)}
                  >
                    <PauseIcon className="size-4" />
                    {t("pause")}
                  </Button>
                }
              />
            )}

            {canExport && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={!effectiveChallengeId}>
                    <DownloadIcon className="size-4" />
                    {t("exportData")}
                    <ChevronDownIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                {effectiveChallengeId && (
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem asChild>
                      <a href={exportHref(exportUrls(effectiveChallengeId).queue)}>
                        <DownloadIcon className="size-4" />
                        {t("queueExportLabel")}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={exportHref(exportUrls(effectiveChallengeId).evaluations)}>
                        <DownloadIcon className="size-4" />
                        {t("evaluationsExport")}
                      </a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            )}
          </div>
        </div>
      </Card>

      {actionError && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm"
        >
          <span>{actionError}</span>
          <button
            type="button"
            aria-label={t("dismiss")}
            onClick={() => setActionError(null)}
            className="shrink-0 opacity-70 transition-opacity hover:opacity-100"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      )}

      {roomsLoading || roomView.loading ? (
        <div className="flex min-h-[360px] flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : !view ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={DoorOpenIcon}
            title={roomView.error ? t("couldNotLoadQueueSetup") : t("noRoomSelected")}
            description={
              roomView.error
                ? errorMessage(roomView.error, t("couldNotLoadQueueSetup"))
                : t("noRoomSelectedDesc")
            }
          />
        </div>
      ) : (
        // Two-column region fills the remaining height. Left column is pinned and
        // scrolls internally if the queue is long; right column is the scroll area.
        <div className="grid gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="xl:min-h-0 xl:overflow-y-auto">
            <QueuePanel
              view={view}
              progress={progress.data}
              pace={pace.data}
              canOperate={canOperate}
              canJudge={canJudge}
              canAdmin={canAdmin}
              busy={busy}
              query={search}
              results={searchResults}
              searching={searching}
              searchDisabled={!effectiveChallengeId}
              onQuery={setSearch}
              onManualCall={handleManualCall}
              onEntryAction={(entry, action, body, label) =>
                mutate(
                  `${action}-${entry.id}`,
                  () => entryAction(entry.id, action, body, crypto.randomUUID()),
                  label,
                )
              }
              onAddTop={(entry) =>
                mutate(
                  `move-top-${entry.id}`,
                  () =>
                    entryAction(
                      entry.id,
                      "move-top",
                      { reason: "Search: moved to top of queue" },
                      crypto.randomUUID(),
                    ),
                  t("teamMovedTop"),
                )
              }
              onAddWaiting={(entry) =>
                activeRoomId &&
                mutate(
                  `add-waiting-${entry.id}`,
                  () =>
                    entryAction(
                      entry.id,
                      "manual-call",
                      {
                        targetStatus: "called",
                        roomId: activeRoomId,
                        reason: "Search: to waiting room",
                      },
                      crypto.randomUUID(),
                    ),
                  t("teamAddedWaiting"),
                )
              }
              onReEnter={(entry, position) =>
                mutate(
                  `re-enter-${entry.id}-${position}`,
                  () =>
                    entryAction(
                      entry.id,
                      "re-enter",
                      { position, reason: "Recovered from manual search" },
                      crypto.randomUUID(),
                    ),
                  t("teamReentered"),
                )
              }
              onOpenReview={setSelectedReviewEntry}
            />
          </div>

          {/* Main column: evaluated project card, then scoring / questions
              flowing directly below it. This column owns the page scroll. */}
          <div className="space-y-5 xl:min-h-0 xl:overflow-y-auto">
            <PresentationPanel
              entry={active}
              challenge={activeChallenge}
              pace={pace.data}
              waitingRoomCount={view.called.length}
              nextWaitingEntry={view.next[0] ?? null}
              firstCalledEntry={view.called[0] ?? null}
              canJudge={canJudge}
              canOperate={canOperate}
              busy={busy}
              onEntryAction={(entry, action, body, label) =>
                mutate(
                  `${action}-${entry.id}`,
                  () => entryAction(entry.id, action, body, crypto.randomUUID()),
                  label,
                )
              }
              onManualCall={handleManualCall}
            />

            <ReviewForm
              entry={selectedReviewEntry ?? active}
              challenge={activeChallenge}
              roomId={activeRoomId}
              canJudge={
                canJudge && (active?.status === "presenting" || selectedReviewEntry != null)
              }
              onCloseExisting={selectedReviewEntry ? () => setSelectedReviewEntry(null) : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function QueueStatsCard({
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

function ConfirmAction({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  /** Omit when driving the dialog externally via `open`/`onOpenChange` (e.g. from a dropdown item). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useLocale();
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialogPrimitive.Content className="bg-background fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border p-6 shadow-lg sm:max-w-lg">
          <AlertDialogPrimitive.Title className="type-section-title text-balance">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-muted-foreground text-pretty text-sm">
            {description}
          </AlertDialogPrimitive.Description>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline">{t("cancel")}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

function QueuePanel({
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
 * H37 search-as-you-type. Each hit offers the two "add" actions from the story:
 * move to the top of the queue, or drop straight into the waiting room. Both
 * only ever MOVE the existing queue entry (never create a second evaluation).
 */
function TeamSearch({
  query,
  results,
  searching,
  trimmed,
  busy,
  canOperate,
  canJudge,
  onQuery,
  onAddTop,
  onAddWaiting,
  onReEnter,
  onBringIn,
  onOpenReview,
}: {
  query: string;
  results: QueueSearchResult[];
  searching: boolean;
  trimmed: string;
  busy: string | null;
  canOperate: boolean;
  canJudge: boolean;
  onQuery: (value: string) => void;
  onAddTop: (entry: QueueSearchResult) => void;
  onAddWaiting: (entry: QueueSearchResult) => void;
  onReEnter: (entry: QueueSearchResult, position: "top" | "bottom") => void;
  onBringIn: (entry: QueueSearchResult) => void;
  onOpenReview: (entry: QueueSearchResult) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-3">
      <div className="relative">
        <Label htmlFor="judging-team-search" className="sr-only">
          {t("searchTeamsAria")}
        </Label>
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          id="judging-team-search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("searchProjectPlaceholder")}
          className="pl-9"
        />
      </div>
      {!trimmed ? (
        <p className="text-muted-foreground py-2 text-center text-xs">{t("startTypingFindTeam")}</p>
      ) : searching && results.length === 0 ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : results.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center text-xs">{t("noTeamsFound")}</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {results.map((entry) => (
            <li key={entry.id} className="bg-background rounded-md border p-3">
              <p className="truncate text-sm font-medium">{entryLabel(entry, t)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <QueueStatusBadge status={entry.status} />
                {entry.has_review && (
                  <StatusBadge tone={entry.review_status === "submitted" ? "success" : "warning"}>
                    {entry.review_status ?? t("reviewFallback")}
                  </StatusBadge>
                )}
              </div>
              {entry.blocked_by_room_name ? (
                <p
                  className="mt-2 text-pretty text-xs text-amber-700 dark:text-amber-300"
                  role="status"
                >
                  {t("teamBusyInOtherRoom", { room: entry.blocked_by_room_name })}
                </p>
              ) : null}
              {entry.has_review ? (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  disabled={busy != null || !canJudge}
                  onClick={() => onOpenReview(entry)}
                >
                  {t("openExistingEvaluation")}
                </Button>
              ) : ["completed", "cancelled", "disqualified"].includes(entry.status) ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onReEnter(entry, "top")}
                  >
                    {t("reenterTop")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onReEnter(entry, "bottom")}
                  >
                    {t("reenterBottom")}
                  </Button>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onAddTop(entry)}
                  >
                    <ArrowUpToLineIcon className="size-4" />
                    {t("topOfQueue")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy != null || !canOperate || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onAddWaiting(entry)}
                  >
                    <DoorOpenIcon className="size-4" />
                    {t("waitingRoomButton")}
                  </Button>
                  <Button
                    size="sm"
                    className="col-span-2"
                    disabled={busy != null || !canJudge || Boolean(entry.blocked_by_room_name)}
                    onClick={() => onBringIn(entry)}
                  >
                    <DoorOpenIcon className="size-4" />
                    {t("bringInDirectly")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Actions for a team at the door, compacted to two button rows: a primary
 * row (Call in / Bring in) and a "More" menu for the rarer moves (requeue,
 * no-show, disqualify) instead of five separate buttons wrapping across
 * three rows in the 360px sidebar.
 */
function CalledEntryActions({
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

function QueueList({
  title,
  entries,
  empty,
  compact,
  scroll,
  desiredMinutesPerTeam,
  renderActions,
}: {
  title: string;
  entries: QueueEntry[];
  empty: string;
  compact?: boolean;
  scroll?: boolean;
  desiredMinutesPerTeam?: number | null;
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
                          hasWaitedTooLong(entry.called_at, desiredMinutesPerTeam ?? null) &&
                            "text-amber-700 dark:text-amber-400",
                        )}
                      >
                        {t("calledAt", {
                          time: new Date(entry.called_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                        })}
                        {hasWaitedTooLong(entry.called_at, desiredMinutesPerTeam ?? null) &&
                          ` · ${t("calledTooLong")}`}
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

function PresentationPanel({
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

function ProjectInfo({ entry, challenge }: { entry: QueueEntry; challenge: Challenge | null }) {
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

function PresentationTimer({
  startedAt,
  totalMinutes,
}: {
  startedAt: string | null;
  /** Already capped by the challenge's max and squeezed for remaining time (H39). */
  totalMinutes: number | null;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(Date.now());

  // The pace (and its cap/squeeze) is a live value that keeps recomputing as
  // the schedule and pending count change — refetching it mid-presentation
  // must not shift the total this timer counts against, or the remaining/
  // overtime figure would jump around instead of counting smoothly. Freeze it
  // per presentation (keyed by startedAt), capturing it once if it wasn't
  // ready yet when the presentation began.
  const frozen = useRef<{ key: string | null; minutes: number | null }>({
    key: null,
    minutes: null,
  });
  if (frozen.current.key !== startedAt) {
    frozen.current = { key: startedAt, minutes: totalMinutes };
  } else if (frozen.current.minutes == null && totalMinutes != null) {
    frozen.current.minutes = totalMinutes;
  }
  const totalSeconds =
    frozen.current.minutes != null ? Math.round(frozen.current.minutes * 60) : null;
  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsedSeconds =
    startedMs && Number.isFinite(startedMs) ? Math.max(0, Math.floor((now - startedMs) / 1000)) : 0;
  // Stopwatch, not a countdown: always counts up from 0. Only the color
  // cues (last-minute amber, over-max red) change as elapsed crosses
  // thresholds — the displayed number itself never resets or jumps.
  const remainingSeconds = totalSeconds != null ? totalSeconds - elapsedSeconds : null;
  const progressValue =
    totalSeconds && totalSeconds > 0 ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0;
  const isOverTime = remainingSeconds != null && remainingSeconds < 0;
  const isWrappingUp =
    !isOverTime &&
    remainingSeconds != null &&
    totalSeconds != null &&
    totalSeconds > 0 &&
    remainingSeconds <= Math.max(60, Math.ceil(totalSeconds * 0.1));
  const timerTone = isOverTime ? "danger" : isWrappingUp ? "warning" : "default";
  const cueText = isOverTime ? t("timeLimitExceeded") : isWrappingUp ? t("wrapUp") : t("onTime");

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

function ReviewForm({
  entry,
  challenge,
  roomId,
  canJudge,
  onCloseExisting,
}: {
  entry: QueueEntry | null;
  challenge: Challenge | null;
  roomId: number | null;
  canJudge: boolean;
  onCloseExisting?: () => void;
}) {
  const { t } = useLocale();
  const panel = challenge?.judging_panel_criteria ?? EMPTY_PANEL;
  const [scores, setScores] = useState<Answers>({});
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [sessions, setSessions] = useState<JudgingSession[]>([]);
  const [versions, setVersions] = useState<AttemptReviewVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const reviewStampRef = useRef<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [externalUpdate, setExternalUpdate] = useState<string | null>(null);
  const unanswered = requiredUnanswered(panel, scores);
  const statusBadge = reviewStatusBadge(status);
  const fieldCopy = useMemo(
    () => ({ notes: t("notesLabel"), status: t("evaluationStateLabel"), scores: t("scoring") }),
    [t],
  );
  const describeFields = useCallback(
    (fields: readonly string[]) => changedFieldsLabel(fields, panel, fieldCopy),
    [panel, fieldCopy],
  );

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const loadRemote = useCallback(
    async (external = false) => {
      if (!entry) return;
      const [review, activeSessions, reviewVersions] = await Promise.all([
        getReview(entry.id),
        getSessions(entry.id),
        getReviewVersions(entry.id),
      ]);
      setSessions(activeSessions);
      setVersions(reviewVersions);
      const remoteStamp = review.updated_at ?? review.created_at ?? JSON.stringify(review);
      if (external && (savingRef.current || remoteStamp === reviewStampRef.current)) return;
      if (external && dirtyRef.current) {
        setConflict(true);
        return;
      }
      setScores(normalizeAnswers(panel, review.scores));
      setNotes(review.notes ?? "");
      setStatus(review.status);
      reviewStampRef.current = remoteStamp;
      dirtyRef.current = false;
      setDirty(false);
      setConflict(false);
      if (external) {
        const last = reviewVersions.at(-1);
        setExternalUpdate(
          last ? describeFields(last.changed_fields) : t("evaluationUpdatedElsewhere"),
        );
      }
    },
    [describeFields, entry, panel, t],
  );

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setLoading(true);
    setSaveError(null);
    void Promise.all([
      loadRemote(),
      canJudge
        ? openSession(entry.id, roomId ?? undefined).catch(() => null)
        : Promise.resolve(null),
    ])
      .catch((err) => setSaveError(errorMessage(err, t("couldNotLoadReview"))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (canJudge) void closeSession(entry.id).catch(() => undefined);
    };
  }, [entry, canJudge, loadRemote, roomId, t]);

  useEventSource("/api/events/stream", {
    events: [EVENTS.DATA_CHANGED],
    enabled: entry != null,
    onEvent: () => void loadRemote(true),
  });

  const save = useCallback(
    async (submit = false, announce = true) => {
      if (!entry || !online) return;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      try {
        const review = await saveReview(entry.id, { scores, notes, submit });
        setStatus(review.status);
        reviewStampRef.current = review.updated_at ?? review.created_at ?? JSON.stringify(review);
        dirtyRef.current = false;
        setDirty(false);
        setConflict(false);
        setVersions(await getReviewVersions(entry.id));
        if (announce) toast.success(submit ? t("reviewSubmitted") : t("draftSaved"));
      } catch (err) {
        const message = errorMessage(err, t("couldNotSaveReview"));
        setSaveError(message);
        if (announce) toast.error(message);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [entry, scores, notes, online, t],
  );

  useEffect(() => {
    if (!dirty || !online || !canJudge || conflict) return;
    const timer = window.setTimeout(() => void save(false, false), 800);
    return () => window.clearTimeout(timer);
  }, [canJudge, conflict, dirty, online, save]);

  const syncState = collaborationState({ online, saving, conflict, dirty });
  const syncLabel = {
    saving: t("collaborationSaving"),
    saved: t("collaborationSaved"),
    offline: t("collaborationOffline"),
    conflict: t("collaborationConflict"),
    unsaved: t("collaborationUnsaved"),
  }[syncState];

  if (!entry) {
    return (
      <SectionCard title={t("scoring")} description={t("scoringFormDesc")}>
        <p className="text-muted-foreground text-sm">{t("noActiveEntrySelected")}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={t("scoring")}
      description={t("scoringSaveDesc")}
      icon={CheckCircle2Icon}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className="text-muted-foreground text-sm">
            {syncState === "offline" && <WifiOffIcon className="mr-1 inline size-4" />}
            {syncLabel}
          </span>
          <StatusBadge tone={statusBadge.tone}>{t(statusBadge.shortLabelKey)}</StatusBadge>
          {onCloseExisting && (
            <Button size="sm" variant="outline" onClick={onCloseExisting}>
              {t("closeExistingEvaluation")}
            </Button>
          )}
        </div>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={!canJudge || saving || loading}
            onClick={() => save(false)}
          >
            {status === "submitted" ? t("saveCorrection") : t("saveDraft")}
          </Button>
          {status !== "submitted" && (
            <Button
              disabled={!canJudge || saving || loading || unanswered > 0}
              onClick={() => save(true)}
            >
              <CheckCircle2Icon className="size-4" />
              {t("submitReview")}
            </Button>
          )}
        </div>
      }
    >
      {loading ? (
        <Spinner />
      ) : panel.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noJudgingCriteria")}</p>
      ) : (
        <div className="space-y-5">
          {saveError && (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border p-3 text-sm"
            >
              {saveError}
            </div>
          )}
          {syncState === "offline" && (
            <div
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
            >
              {t("offlineEvaluationPending")}
            </div>
          )}
          {syncState === "conflict" && (
            <div
              role="alert"
              className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm"
            >
              <p>{t("evaluationConflictDescription")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void loadRemote(false)}>
                  {t("loadLatestEvaluation")}
                </Button>
                <Button size="sm" onClick={() => void save(false)}>
                  {t("keepMyEvaluation")}
                </Button>
              </div>
            </div>
          )}
          {externalUpdate && !conflict && (
            <p role="status" className="text-muted-foreground text-sm">
              {t("criterionUpdatedElsewhere", { fields: externalUpdate })}
            </p>
          )}
          {unanswered > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangleIcon className="size-4 shrink-0" />
              {unanswered === 1
                ? t("requiredFieldUnansweredOne", { count: unanswered })
                : t("requiredFieldUnansweredOther", { count: unanswered })}
            </div>
          )}
          {sessions.length > 0 && (
            <div className="rounded-md border px-3 py-2">
              <p className="text-sm font-medium">{t("activeJudges")}</p>
              <p className="text-muted-foreground text-sm">
                {sessions
                  .map((session) =>
                    `${session.name ?? t("judgeFallback")} ${session.surname ?? ""}`.trim(),
                  )
                  .join(", ")}
              </p>
            </div>
          )}
          {panel.map((question) => (
            <QuestionField
              key={question.key}
              question={question}
              value={scores[question.key]}
              disabled={!canJudge}
              onChange={(value) => {
                setScores((current) => ({ ...current, [question.key]: value }));
                dirtyRef.current = true;
                setDirty(true);
                setExternalUpdate(null);
              }}
            />
          ))}
          <div className="space-y-2">
            <Label htmlFor="review-notes">{t("notesLabel")}</Label>
            <Textarea
              id="review-notes"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                dirtyRef.current = true;
                setDirty(true);
              }}
              disabled={!canJudge}
              placeholder={t("privateJudgingNotes")}
            />
          </div>
          {versions.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {t("evaluationVersionHistory")}
              </summary>
              <ol className="mt-3 space-y-2">
                {[...versions].reverse().map((version) => (
                  <li key={version.id} className="text-muted-foreground text-sm">
                    <span className="text-foreground font-medium">
                      {`${version.name ?? t("judgeFallback")} ${version.surname ?? ""}`.trim()}
                    </span>{" "}
                    · {new Date(version.created_at).toLocaleString()} ·{" "}
                    {describeFields(version.changed_fields)}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </SectionCard>
  );
}
