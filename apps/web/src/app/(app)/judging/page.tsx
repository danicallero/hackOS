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
  DoorOpenIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SkipForwardIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  callNext,
  closeSession,
  entryAction,
  exportUrls,
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

function challengeName(challenge?: Challenge | null, fallback?: number): string {
  return challenge ? textForDisplay(challenge.title) : fallback ? `Challenge #${fallback}` : "—";
}

function entryLabel(entry: QueueEntry): string {
  return entry.repo_name ?? `Repo #${entry.repo_id}`;
}

function secondsLabel(value: number | null | undefined): string {
  if (value == null) return "—";
  const safe = Math.max(0, Math.floor(value));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
  const { can, canAny } = useSessionContext();
  const canOperate = can(CAPABILITIES.QUEUE_OPERATE);
  const canJudge = can(CAPABILITIES.JUDGE_PANEL);
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  const canExport = can(CAPABILITIES.JUDGING_EXPORT);
  const canUse = canAny(
    CAPABILITIES.QUEUE_OPERATE,
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.JUDGE_PANEL,
  );

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
    { enabled: canUse && activeRoomId != null },
  );

  const pace = useLiveQuery<RoomPace>(
    () => (activeRoomId ? getRoomPace(activeRoomId) : Promise.resolve(null as never)),
    "/api/queue/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    { enabled: canUse && activeRoomId != null },
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
      toast.error(errorMessage(err, "Could not load queue setup."));
    } finally {
      setRoomsLoading(false);
    }
  }, [canUse]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  const refreshLive = useCallback(async () => {
    await Promise.all([roomView.refetch(), pace.refetch()]);
  }, [roomView, pace]);

  const mutate = useCallback(
    async (key: string, action: () => Promise<unknown>, success: string) => {
      setBusy(key);
      try {
        await action();
        toast.success(success);
        await refreshLive();
      } catch (err) {
        toast.error(errorMessage(err, "Queue action failed."));
      } finally {
        setBusy(null);
      }
    },
    [refreshLive],
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
        if (!cancelled) toast.error(errorMessage(err, "Search failed."));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [effectiveChallengeId, search]);

  if (!canUse) {
    return (
      <div className="space-y-6">
        <PageHeader title="Judging" />
        <EmptyState
          icon={LockIcon}
          title="You can't access the judging panel"
          description="Judging access requires an operator, admin or judge capability."
        />
      </div>
    );
  }

  const view = roomView.data;
  const active = view?.active ?? null;
  const state = view?.state ?? null;
  const isPaused = state?.is_paused ?? view?.room.status === "paused";
  const challengeLabel =
    view?.challenge?.title ?? (activeChallenge ? challengeName(activeChallenge) : "—");

  return (
    // App-like layout: the room selector pins to the top, the queue panel stays
    // put on the left, and only the right column (project + scoring) scrolls.
    // At xl we clamp the whole page to the viewport (100dvh minus the app chrome:
    // 3.5rem header + 2rem+2rem main py-8) so the outer page never scrolls.
    <div className="flex flex-col gap-5 xl:h-[calc(100dvh-7.5rem)]" data-wide>
      <Card className="gap-0 p-5">
        <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="queue-room">Room</Label>
            <Select
              value={activeRoomId ? String(activeRoomId) : ""}
              onValueChange={(value) => setRoomId(Number(value))}
              disabled={roomsLoading || rooms.length === 0}
            >
              <SelectTrigger id="queue-room" className="w-full">
                <SelectValue placeholder="Select room" />
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
          <div className="space-y-2">
            <Label>Challenge</Label>
            <div className="border-input bg-muted/40 text-muted-foreground flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm">
              <LockIcon className="size-3.5 shrink-0" />
              <span className="text-foreground truncate font-medium">{challengeLabel}</span>
            </div>
          </div>

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
                isPaused ? "Room resumed." : "Room paused.",
              )
            }
          >
            {isPaused ? <PlayIcon className="size-4" /> : <PauseIcon className="size-4" />}
            {isPaused ? "Resume" : "Pause"}
          </Button>
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
            title="No room selected"
            description="Create or select a judging room before operating the queue."
          />
        </div>
      ) : (
        // Two-column region fills the remaining height. Left column is pinned and
        // scrolls internally if the queue is long; right column is the scroll area.
        <div className="grid gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="xl:min-h-0 xl:overflow-y-auto">
            <QueuePanel
              view={view}
              canOperate={canOperate}
              canJudge={canJudge}
              busy={busy}
              query={search}
              results={searchResults}
              searching={searching}
              searchDisabled={!effectiveChallengeId}
              onQuery={setSearch}
              onCallNext={() =>
                activeRoomId &&
                mutate(
                  "call-next",
                  () => callNext(activeRoomId, crypto.randomUUID()),
                  "Next team called.",
                )
              }
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
                  targetStatus === "in_room" ? "Team brought into room." : "Team called.",
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
                  "Team moved to the top of the queue.",
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
                  "Team added to the waiting room.",
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
                    "Team brought in.",
                  );
                  return;
                }
                if (activeRoomId) {
                  mutate(
                    "call-next",
                    () => callNext(activeRoomId, crypto.randomUUID()),
                    "Next team called.",
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

      {/* Unobtrusive footer: CSV exports and the room admin shortcut, moved out
          of the (removed) page header and gated exactly as before. */}
      {(canAdmin || (canExport && effectiveChallengeId)) && (
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          {canExport && effectiveChallengeId && (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={exportHref(exportUrls(effectiveChallengeId).queue)}>
                  <DownloadIcon className="size-4" />
                  Queue CSV
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={exportHref(exportUrls(effectiveChallengeId).evaluations)}>
                  <DownloadIcon className="size-4" />
                  Evaluations CSV
                </a>
              </Button>
            </>
          )}
          {canAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/queue/rooms">Room admin</Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function QueuePanel({
  view,
  canOperate,
  canJudge,
  busy,
  query,
  results,
  searching,
  searchDisabled,
  onQuery,
  onCallNext,
  onManualCall,
  onEntryAction,
  onAddTop,
  onAddWaiting,
}: {
  view: RoomView;
  canOperate: boolean;
  canJudge: boolean;
  busy: string | null;
  query: string;
  results: QueueSearchResult[];
  searching: boolean;
  searchDisabled: boolean;
  onQuery: (value: string) => void;
  onCallNext: () => void;
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
  const [searchOpen, setSearchOpen] = useState(false);
  const waitingEntries = view.next;
  const calledEntries = view.called;
  const trimmed = query.trim();

  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <h2 className="text-base font-semibold">Queue</h2>
          <p className="text-muted-foreground text-sm">Waiting room and challenge queue.</p>
        </div>
        <Button disabled={!canOperate || busy === "call-next"} onClick={onCallNext}>
          <BellRingIcon className="size-4" />
          Call next
        </Button>
      </div>
      <Separator />
      <div className="space-y-5 p-5">
        <QueueList
          title={`Waiting room (${calledEntries.length})`}
          entries={calledEntries}
          empty="No teams waiting at the door."
          compact
          renderActions={(entry) => (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                disabled={busy != null || !canJudge}
                onClick={() => onEntryAction(entry, "bring-in", undefined, "Team brought in.")}
              >
                <DoorOpenIcon className="size-4" />
                Bring in
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy != null || (!canJudge && !canOperate)}
                onClick={() =>
                  onEntryAction(
                    entry,
                    "requeue",
                    { position: "bottom", reason: "Returned from waiting room" },
                    "Team returned to the queue.",
                  )
                }
              >
                <RotateCcwIcon className="size-4" />
                Requeue
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy != null || (!canJudge && !canOperate)}
                onClick={() =>
                  onEntryAction(entry, "notify-enter", undefined, "Entrance notice sent.")
                }
              >
                <SendIcon className="size-4" />
                Notify
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy != null || (!canJudge && !canOperate)}
                onClick={() =>
                  onEntryAction(entry, "no-show", { reason: "No show" }, "No-show recorded.")
                }
              >
                <AlertTriangleIcon className="size-4" />
                No-show
              </Button>
            </div>
          )}
        />

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Challenge queue ({waitingEntries.length})</h3>
              <p className="text-muted-foreground text-xs">Upcoming teams for this room.</p>
            </div>
            <Button
              size="icon"
              variant={searchOpen ? "secondary" : "ghost"}
              aria-label="Search teams"
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
            empty="No teams in the challenge queue."
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
                  Call
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy != null || !canOperate}
                  onClick={() =>
                    onEntryAction(entry, "skip", { reason: "Skipped by operator" }, "Team skipped.")
                  }
                >
                  <SkipForwardIcon className="size-4" />
                  Skip
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
  return (
    <div className="bg-muted/30 space-y-3 rounded-md border p-3">
      <div className="relative">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search by project, repo id or entry id"
          className="pl-9"
        />
      </div>
      {!trimmed ? (
        <p className="text-muted-foreground py-2 text-center text-xs">
          Start typing to find a team.
        </p>
      ) : searching && results.length === 0 ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : results.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center text-xs">No teams found.</p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {results.map((entry) => (
            <li key={entry.id} className="bg-background rounded-md border p-3">
              <p className="truncate text-sm font-medium">{entryLabel(entry)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <QueueStatusBadge status={entry.status} />
                {entry.has_review && (
                  <StatusBadge tone={entry.review_status === "submitted" ? "success" : "warning"}>
                    {entry.review_status ?? "review"}
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
                  Top of queue
                </Button>
                <Button
                  size="sm"
                  disabled={busy != null || !canOperate}
                  onClick={() => onAddWaiting(entry)}
                >
                  <DoorOpenIcon className="size-4" />
                  Waiting room
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
                    {entryLabel(entry)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <QueueStatusBadge status={entry.status} />
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
  const isPresenting = entry?.status === "presenting";
  const isReady = entry?.status === "in_room";

  return (
    <Card className={cn("gap-0 overflow-hidden p-0", entry && "border-primary/30 bg-primary/5")}>
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold text-balance">
            {entry ? entryLabel(entry) : "Waiting for next team"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {entry
              ? isPresenting
                ? "Presentation in progress"
                : isReady
                  ? "Ready to start"
                  : "Team in room"
              : "Bring in a team to start presentation and scoring."}
          </p>
        </div>
        {entry ? (
          <QueueStatusBadge status={entry.status} />
        ) : (
          <StatusBadge tone="neutral">Idle</StatusBadge>
        )}
      </div>
      <Separator />
      <div className="space-y-5 p-6">
        {!entry ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed p-6 text-center">
            <DoorOpenIcon className="text-muted-foreground mb-3 size-8" />
            <p className="text-sm font-medium">No presentation in progress</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {waitingRoomCount > 0
                ? "There are teams waiting at the door."
                : "Call the next team into the waiting room."}
            </p>
            <Button className="mt-4" disabled={busy != null} onClick={onEmptyAction}>
              {waitingRoomCount > 0 ? (
                <DoorOpenIcon className="size-4" />
              ) : (
                <BellRingIcon className="size-4" />
              )}
              {waitingRoomCount > 0 ? "Bring in" : "Call next"}
            </Button>
          </div>
        ) : (
          <>
            <ProjectInfo entry={entry} challenge={challenge} />

            {isPresenting && (
              <PresentationTimer
                startedAt={entry.presentation_started_at}
                maxSeconds={challenge?.max_presentation_seconds ?? null}
                fallbackMinutes={pace?.effectiveMinutesPerTeam ?? null}
              />
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                disabled={!canJudge || !isReady || busy != null}
                onClick={() => onEntryAction(entry, "start", undefined, "Presentation started.")}
              >
                <PlayIcon className="size-4" />
                Start
              </Button>
              <Button
                variant="outline"
                disabled={!canJudge || !isPresenting || busy != null}
                onClick={() =>
                  onEntryAction(entry, "complete", undefined, "Presentation completed.")
                }
              >
                <CheckCircle2Icon className="size-4" />
                Complete
              </Button>
              <Button
                variant="outline"
                disabled={!canJudge || busy != null}
                onClick={() =>
                  onEntryAction(
                    entry,
                    "send-back",
                    { reason: "Sent back from judging room" },
                    "Team sent back to waiting area.",
                  )
                }
              >
                <RotateCcwIcon className="size-4" />
                Requeue
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

function ProjectInfo({ entry, challenge }: { entry: QueueEntry; challenge: Challenge | null }) {
  const members = entry.repo_members ?? [];
  const links = [
    { label: "Demo", href: entry.repo_demo_url },
    { label: "Devpost", href: entry.repo_devpost_url },
    { label: "GitHub", href: entry.repo_github_url },
  ].filter((link): link is { label: string; href: string } => Boolean(link.href));

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-background p-4">
        <div className="mb-2 flex items-center gap-2">
          <UsersIcon className="text-muted-foreground size-4" />
          <p className="text-xs font-semibold uppercase">Members</p>
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
        <div className="rounded-md border bg-background p-4">
          <p className="mb-2 text-xs font-semibold uppercase">Project</p>
          <p className="text-muted-foreground line-clamp-5 text-sm text-pretty">
            {entry.repo_description}
          </p>
        </div>
      )}

      {links.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {links.map((link) => (
            <Button key={link.label} variant="outline" size="sm" asChild>
              <a href={link.href} target="_blank" rel="noreferrer">
                <ExternalLinkIcon className="size-4" />
                {link.label}
              </a>
            </Button>
          ))}
        </div>
      )}

      {challenge && (
        <div className="rounded-md border bg-background p-4">
          <p className="mb-1 text-xs font-semibold uppercase">Current challenge</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {challengeName(challenge, entry.challenge_id)}
            </span>
            <StatusBadge tone="success">Now</StatusBadge>
          </div>
        </div>
      )}
    </div>
  );
}

function PresentationTimer({
  startedAt,
  maxSeconds,
  fallbackMinutes,
}: {
  startedAt: string | null;
  maxSeconds: number | null;
  fallbackMinutes: number | null;
}) {
  const [now, setNow] = useState(Date.now());
  const totalSeconds =
    maxSeconds ?? (fallbackMinutes != null ? Math.round(fallbackMinutes * 60) : null);
  const startedMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsedSeconds =
    startedMs && Number.isFinite(startedMs) ? Math.max(0, Math.floor((now - startedMs) / 1000)) : 0;
  const remainingSeconds = totalSeconds != null ? Math.max(0, totalSeconds - elapsedSeconds) : null;
  const progressValue =
    totalSeconds && totalSeconds > 0 ? Math.min(100, (elapsedSeconds / totalSeconds) * 100) : 0;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase">Time remaining</p>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">
            {secondsLabel(remainingSeconds)}
          </p>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          of {secondsLabel(totalSeconds)}
        </p>
      </div>
      <Progress value={progressValue} className="mt-3" />
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
      .catch((err) => toast.error(errorMessage(err, "Could not load review.")))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (canJudge) void closeSession(entry.id).catch(() => undefined);
    };
  }, [entry, canJudge, panel, roomId]);

  const save = useCallback(
    async (submit = false) => {
      if (!entry) return;
      setSaving(true);
      try {
        const review = await saveReview(entry.id, { scores, notes, submit });
        setStatus(review.status);
        toast.success(submit ? "Review submitted." : "Draft saved.");
      } catch (err) {
        toast.error(errorMessage(err, "Could not save review."));
      } finally {
        setSaving(false);
      }
    },
    [entry, scores, notes],
  );

  if (!entry) {
    return (
      <SectionCard title="Scoring" description="A scoring form appears when a team is in the room.">
        <p className="text-muted-foreground text-sm">No active entry selected.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Scoring"
      description="Save draft answers while judging, then submit the final review."
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
            Save draft
          </Button>
          <Button
            disabled={!canJudge || saving || loading || requiredUnanswered > 0}
            onClick={() => save(true)}
          >
            <CheckCircle2Icon className="size-4" />
            Submit review
          </Button>
        </div>
      }
    >
      {loading ? (
        <Spinner />
      ) : panel.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This challenge does not have judging criteria configured yet.
        </p>
      ) : (
        <div className="space-y-5">
          {requiredUnanswered > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangleIcon className="size-4 shrink-0" />
              {requiredUnanswered} required field{requiredUnanswered === 1 ? "" : "s"} unanswered
            </div>
          )}
          {sessions.length > 0 && (
            <div className="rounded-md border px-3 py-2">
              <p className="text-sm font-medium">Active judges</p>
              <p className="text-muted-foreground text-sm">
                {sessions
                  .map((session) => `${session.name ?? "Judge"} ${session.surname ?? ""}`.trim())
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
            <Label htmlFor="review-notes">Notes</Label>
            <Textarea
              id="review-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={!canJudge || status === "submitted"}
              placeholder="Private judging notes"
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
              Clear
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
            Yes
          </Label>
        </div>
      ) : question.kind === "single_choice" ? (
        <Select
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onValueChange={onChange}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Select an option" />
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
        Key: <span className="font-mono">{question.key}</span>
      </p>
    </div>
  );
}
