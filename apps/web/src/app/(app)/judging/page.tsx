"use client";

// Queue and judging panel (H29-H40). The layout follows the older judging
// panel's room header + left queue + right presentation/review structure, but
// uses this app's shared API wrappers, cards, tabs and form controls.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { AnswerValue, Question } from "@hackos/shared/questions";
import {
  AlertTriangleIcon,
  ArrowUpToLineIcon,
  BellRingIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  DoorOpenIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LockIcon,
  MoreVerticalIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SkipForwardIcon,
  UsersIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { type Translate, useLocale } from "@/lib/i18n";
import {
  type ChallengeProgress,
  callNext,
  closeSession,
  entryAction,
  exportUrls,
  getChallengeProgress,
  getRepoChallenges,
  getReview,
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

type Scores = Record<string, AnswerValue>;

const SCORE_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

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

function defaultValue(question: Question): AnswerValue {
  switch (question.kind) {
    case "scale":
      return question.min;
    case "integer":
    case "float":
      return question.min ?? 0;
    case "boolean":
      return false;
    case "multi_choice":
      return [];
    default:
      return "";
  }
}

function answerHasValue(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function normalizeScores(panel: Question[], raw: Record<string, unknown> | undefined): Scores {
  const next: Scores = {};
  for (const q of panel) {
    const current = raw?.[q.key];
    if (current === undefined || current === null) {
      next[q.key] = defaultValue(q);
      continue;
    }
    if (q.kind === "multi_choice") next[q.key] = Array.isArray(current) ? current.map(String) : [];
    else if (q.kind === "boolean") next[q.key] = Boolean(current);
    else if (q.kind === "scale" || q.kind === "integer" || q.kind === "float")
      next[q.key] = Number(current);
    else next[q.key] = String(current);
  }
  return next;
}

export default function QueuePage() {
  const { can, canAny, me } = useSessionContext();
  const { t } = useLocale();
  const canOperate = can(CAPABILITIES.QUEUE_OPERATE);
  const canJudge = can(CAPABILITIES.JUDGE_PANEL) || me?.role === "judge";
  const canExport = can(CAPABILITIES.JUDGING_EXPORT);
  const canUse =
    me?.role === "judge" ||
    canAny(CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.JUDGE_PANEL);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomId, setRoomId] = useState<number | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<QueueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

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
      toast.error(errorMessage(err, t("couldNotLoadQueueSetup")));
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
      try {
        await action();
        toast.success(success);
        await refreshLive();
      } catch (err) {
        toast.error(errorMessage(err, t("queueActionFailed")));
      } finally {
        setBusy(null);
      }
    },
    [refreshLive, t],
  );

  // H37 search-as-you-type: debounce the query and refresh results as the
  // operator types. An empty query clears the list.
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
        if (!cancelled) toast.error(errorMessage(err, t("searchFailed")));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [effectiveChallengeId, search, t]);

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
              onValueChange={(value) => setRoomId(Number(value))}
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
            <Button
              variant={isPaused ? "default" : "outline"}
              disabled={!activeRoomId || busy === "pause" || (!canOperate && !canJudge)}
              onClick={() =>
                activeRoomId &&
                mutate(
                  "pause",
                  () =>
                    isPaused
                      ? resumeRoom(activeRoomId, crypto.randomUUID())
                      : pauseRoom(activeRoomId, crypto.randomUUID()),
                  isPaused ? t("roomResumed") : t("roomPaused"),
                )
              }
            >
              {isPaused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
              {isPaused ? t("resume") : t("pause")}
            </Button>

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

      {roomsLoading || roomView.loading ? (
        <div className="flex min-h-[360px] flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : !view ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={DoorOpenIcon}
            title={t("noRoomSelected")}
            description={t("noRoomSelectedDesc")}
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
              busy={busy}
              query={search}
              results={searchResults}
              searching={searching}
              searchDisabled={!effectiveChallengeId}
              onQuery={setSearch}
              onManualCall={(entry, targetStatus) =>
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
                )
              }
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
              canJudge={canJudge}
              busy={busy}
              onEmptyAction={() => {
                const firstCalled = view.called[0];
                if (firstCalled) {
                  mutate(
                    `bring-in-${firstCalled.id}`,
                    () => entryAction(firstCalled.id, "bring-in", undefined, crypto.randomUUID()),
                    t("teamBroughtInShort"),
                  );
                  return;
                }
                if (activeRoomId) {
                  mutate(
                    "call-next",
                    () => callNext(activeRoomId, crypto.randomUUID()),
                    t("nextTeamCalled"),
                  );
                }
              }}
              onEntryAction={(entry, action, body, label) =>
                mutate(
                  `${action}-${entry.id}`,
                  () => entryAction(entry.id, action, body, crypto.randomUUID()),
                  label,
                )
              }
            />

            <ReviewForm
              entry={active}
              challenge={activeChallenge}
              roomId={activeRoomId}
              canJudge={canJudge && active?.status === "presenting"}
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

function QueuePanel({
  view,
  progress,
  pace,
  canOperate,
  canJudge,
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
}: {
  view: RoomView;
  progress: ChallengeProgress | null;
  pace: RoomPace | null;
  canOperate: boolean;
  canJudge: boolean;
  busy: string | null;
  query: string;
  results: QueueSearchResult[];
  searching: boolean;
  searchDisabled: boolean;
  onQuery: (value: string) => void;
  onManualCall: (entry: QueueEntry, targetStatus: "called" | "in_room") => void;
  onEntryAction: (
    entry: QueueEntry,
    action: "notify-enter" | "bring-in" | "requeue" | "no-show" | "skip",
    body: Record<string, unknown> | undefined,
    label: string,
  ) => void;
  onAddTop: (entry: QueueSearchResult) => void;
  onAddWaiting: (entry: QueueSearchResult) => void;
}) {
  const { t } = useLocale();
  const [searchOpen, setSearchOpen] = useState(false);
  const waitingEntries = view.next;
  const calledEntries = view.called;
  const trimmed = query.trim();

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <QueueStatsCard progress={progress} pace={pace} />
      <Separator />
      <div className="space-y-5 p-5">
        <QueueList
          title={t("waitingRoomCount", { count: calledEntries.length })}
          entries={calledEntries}
          empty={t("noTeamsWaitingDoor")}
          compact
          renderActions={(entry) => (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={busy != null || !canJudge}
                onClick={() => onEntryAction(entry, "bring-in", undefined, t("teamBroughtInShort"))}
              >
                <DoorOpenIcon className="size-4" />
                {t("bringIn")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={busy != null || (!canJudge && !canOperate)}
                onClick={() =>
                  onEntryAction(entry, "notify-enter", undefined, t("entranceNoticeSent"))
                }
              >
                <SendIcon className="size-4" />
                {t("callIn")}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={busy != null || (!canJudge && !canOperate)}
                    aria-label={t("moreActions")}
                  >
                    <MoreVerticalIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
                    {t("requeue")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      onEntryAction(entry, "no-show", { reason: "No show" }, t("noShowRecorded"))
                    }
                  >
                    <AlertTriangleIcon className="size-4" />
                    {t("noShow")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
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
            </div>
            <Button
              size="icon"
              variant={searchOpen ? "secondary" : "ghost"}
              aria-label={t("searchTeamsAria")}
              aria-pressed={searchOpen}
              disabled={searchDisabled}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <SearchIcon className="size-4" />
            </Button>
          </div>

          {searchOpen && (
            <TeamSearch
              query={query}
              results={results}
              searching={searching}
              trimmed={trimmed}
              busy={busy}
              canOperate={canOperate}
              onQuery={onQuery}
              onAddTop={onAddTop}
              onAddWaiting={onAddWaiting}
            />
          )}

          <QueueList
            title=""
            entries={waitingEntries}
            empty={t("noTeamsChallengeQueue")}
            scroll
            renderActions={(entry) => (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy != null || !canOperate}
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
            )}
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
  onQuery,
  onAddTop,
  onAddWaiting,
}: {
  query: string;
  results: QueueSearchResult[];
  searching: boolean;
  trimmed: string;
  busy: string | null;
  canOperate: boolean;
  onQuery: (value: string) => void;
  onAddTop: (entry: QueueSearchResult) => void;
  onAddWaiting: (entry: QueueSearchResult) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-3">
      <div className="relative">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
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
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy != null || !canOperate}
                  onClick={() => onAddTop(entry)}
                >
                  <ArrowUpToLineIcon className="size-4" />
                  {t("topOfQueue")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy != null || !canOperate}
                  onClick={() => onAddWaiting(entry)}
                >
                  <DoorOpenIcon className="size-4" />
                  {t("waitingRoomButton")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
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
  renderActions,
}: {
  title: string;
  entries: QueueEntry[];
  empty: string;
  compact?: boolean;
  scroll?: boolean;
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
                        Past calls: {entry.call_count}
                      </span>
                    )}
                    {entry.position != null && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        Position #{entry.position}
                      </span>
                    )}
                    {entry.called_at && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        Called{" "}
                        {new Date(entry.called_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
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
  canJudge,
  busy,
  onEmptyAction,
  onEntryAction,
}: {
  entry: QueueEntry | null;
  challenge: Challenge | null;
  pace: RoomPace | null;
  waitingRoomCount: number;
  canJudge: boolean;
  busy: string | null;
  onEmptyAction: () => void;
  onEntryAction: (
    entry: QueueEntry,
    action: "start" | "complete" | "send-back",
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
            <Button className="mt-4" disabled={busy != null} onClick={onEmptyAction}>
              {waitingRoomCount > 0 ? (
                <DoorOpenIcon className="size-4" />
              ) : (
                <BellRingIcon className="size-4" />
              )}
              {waitingRoomCount > 0 ? t("bringIn") : t("callNext")}
            </Button>
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
                <Button
                  variant="outline"
                  disabled={!canJudge || busy != null}
                  onClick={() =>
                    onEntryAction(
                      entry,
                      "send-back",
                      { reason: "Re-queued to waiting room" },
                      t("teamSentBackWaiting"),
                    )
                  }
                >
                  <RotateCcwIcon className="size-4" />
                  {t("requeueWaitingRoom")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function ProjectDescription({ text }: { text: string }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, []);

  return (
    <div>
      <div
        ref={contentRef}
        className={cn(
          "text-muted-foreground text-sm text-pretty",
          "[&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5",
          "[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5",
          "[&_a]:text-foreground [&_a]:underline [&_strong]:text-foreground [&_strong]:font-semibold",
          "[&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
          "[&_h1]:text-foreground [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-semibold",
          "[&_h2]:text-foreground [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold",
          "[&_h3]:text-foreground [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
          !expanded && "max-h-32 overflow-hidden",
        )}
      >
        <ReactMarkdown>{text}</ReactMarkdown>
      </div>
      {(overflowing || expanded) && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-auto p-0 text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronUpIcon className="size-3.5" />
              {t("showLess")}
            </>
          ) : (
            <>
              <ChevronDownIcon className="size-3.5" />
              {t("showMore")}
            </>
          )}
        </Button>
      )}
    </div>
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
  const totalSeconds = totalMinutes != null ? Math.round(totalMinutes * 60) : null;
  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsedSeconds =
    startedMs && Number.isFinite(startedMs) ? Math.max(0, Math.floor((now - startedMs) / 1000)) : 0;
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
          "font-mono text-sm font-semibold tabular-nums",
          timerTone === "warning" && "text-amber-600 dark:text-amber-400",
          timerTone === "danger" && "text-destructive",
        )}
      >
        {isOverTime
          ? `+${secondsLabel(-(remainingSeconds as number))}`
          : secondsLabel(remainingSeconds)}
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
}: {
  entry: QueueEntry | null;
  challenge: Challenge | null;
  roomId: number | null;
  canJudge: boolean;
}) {
  const { t } = useLocale();
  const panel = challenge?.judging_panel_criteria ?? [];
  const [scores, setScores] = useState<Scores>({});
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<string>("draft");
  const [sessions, setSessions] = useState<JudgingSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const requiredUnanswered = panel.filter(
    (question) => question.required && !answerHasValue(scores[question.key]),
  ).length;

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      getReview(entry.id),
      getSessions(entry.id),
      canJudge
        ? openSession(entry.id, roomId ?? undefined).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([review, activeSessions]) => {
        if (cancelled) return;
        setScores(normalizeScores(panel, review.scores));
        setNotes(review.notes ?? "");
        setStatus(review.status);
        setSessions(activeSessions);
      })
      .catch((err) => toast.error(errorMessage(err, t("couldNotLoadReview"))))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (canJudge) void closeSession(entry.id).catch(() => undefined);
    };
  }, [entry, canJudge, panel, roomId, t]);

  const save = useCallback(
    async (submit = false) => {
      if (!entry) return;
      setSaving(true);
      try {
        const review = await saveReview(entry.id, { scores, notes, submit });
        setStatus(review.status);
        toast.success(submit ? t("reviewSubmitted") : t("draftSaved"));
      } catch (err) {
        toast.error(errorMessage(err, t("couldNotSaveReview")));
      } finally {
        setSaving(false);
      }
    },
    [entry, scores, notes, t],
  );

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
        <StatusBadge tone={status === "submitted" ? "success" : "warning"}>{status}</StatusBadge>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={!canJudge || saving || loading}
            onClick={() => save(false)}
          >
            {t("saveDraft")}
          </Button>
          <Button
            disabled={!canJudge || saving || loading || requiredUnanswered > 0}
            onClick={() => save(true)}
          >
            <CheckCircle2Icon className="size-4" />
            {t("submitReview")}
          </Button>
        </div>
      }
    >
      {loading ? (
        <Spinner />
      ) : panel.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noJudgingCriteria")}</p>
      ) : (
        <div className="space-y-5">
          {requiredUnanswered > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangleIcon className="size-4 shrink-0" />
              {requiredUnanswered === 1
                ? t("requiredFieldUnansweredOne", { count: requiredUnanswered })
                : t("requiredFieldUnansweredOther", { count: requiredUnanswered })}
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
              disabled={!canJudge || status === "submitted"}
              onChange={(value) => setScores((current) => ({ ...current, [question.key]: value }))}
            />
          ))}
          <div className="space-y-2">
            <Label htmlFor="review-notes">{t("notesLabel")}</Label>
            <Textarea
              id="review-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={!canJudge || status === "submitted"}
              placeholder={t("privateJudgingNotes")}
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function QuestionField({
  question,
  value,
  disabled,
  onChange,
}: {
  question: Question;
  value: AnswerValue | undefined;
  disabled: boolean;
  onChange: (value: AnswerValue) => void;
}) {
  const { t } = useLocale();
  const label = textForDisplay(question.label);
  const description = textForDisplay(question.description);
  const id = `question-${question.key}`;

  return (
    <div className="space-y-2 rounded-md border p-4">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
        {question.required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {description && <p className="text-muted-foreground text-sm text-pretty">{description}</p>}
      {question.kind === "scale" && question.min === 0 && question.max === 10 ? (
        <div className="flex flex-wrap gap-1">
          {SCORE_SCALE.map((score) => (
            <Button
              key={score}
              type="button"
              size="sm"
              variant={value === score ? "default" : "outline"}
              className="size-8 p-0 text-xs font-semibold"
              disabled={disabled}
              onClick={() => onChange(score)}
            >
              {score}
            </Button>
          ))}
          {value !== undefined && value !== null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange("")}
            >
              {t("clear")}
            </Button>
          )}
        </div>
      ) : question.kind === "scale" || question.kind === "integer" || question.kind === "float" ? (
        <Input
          id={id}
          type="number"
          min={question.min}
          max={question.max}
          step={question.kind === "float" ? "0.1" : "1"}
          value={typeof value === "number" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      ) : question.kind === "boolean" ? (
        <div className="flex items-center gap-2">
          <Checkbox
            id={id}
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked === true)}
          />
          <Label htmlFor={id} className="font-normal">
            {t("yesLabel")}
          </Label>
        </div>
      ) : question.kind === "single_choice" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onValueChange={onChange}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={t("selectOptionPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {question.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {textForDisplay(option.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : question.kind === "multi_choice" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => {
            const selected = Array.isArray(value) && value.includes(option.value);
            return (
              <div key={option.value} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-${option.value}`}
                  checked={selected}
                  disabled={disabled}
                  onCheckedChange={(checked) => {
                    const current = Array.isArray(value) ? value : [];
                    onChange(
                      checked
                        ? [...current, option.value]
                        : current.filter((item) => item !== option.value),
                    );
                  }}
                />
                <Label htmlFor={`${id}-${option.value}`} className="font-normal">
                  {textForDisplay(option.label)}
                </Label>
              </div>
            );
          })}
        </div>
      ) : question.kind === "long_text" ? (
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          maxLength={question.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={typeof value === "string" ? value : ""}
          maxLength={question.maxLength}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <p className={cn("text-muted-foreground text-xs", disabled && "opacity-70")}>
        {t("keyLabel")} <span className="font-mono">{question.key}</span>
      </p>
    </div>
  );
}
