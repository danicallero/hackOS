"use client";

// Queue and judging panel (H29-H40). The layout follows the older judging
// panel's room header + left queue + right presentation/review structure, but
// uses this app's shared API wrappers, cards, tabs and form controls.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import type { AnswerValue, Question } from "@hackos/shared/questions";
import {
  AlertTriangleIcon,
  BellRingIcon,
  CheckCircle2Icon,
  DoorOpenIcon,
  DownloadIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SkipForwardIcon,
  TimerIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import {
  type ChallengeProgress,
  callNext,
  closeSession,
  entryAction,
  exportUrls,
  getChallengeProgress,
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

function challengeName(challenge?: Challenge | null, fallback?: number): string {
  return challenge ? textForDisplay(challenge.title) : fallback ? `Challenge #${fallback}` : "—";
}

function entryLabel(entry: QueueEntry): string {
  return entry.repo_name ?? `Repo #${entry.repo_id}`;
}

function minutesLabel(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value)} min`;
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
  const [selectedChallengeId, setSelectedChallengeId] = useState<number | null>(null);
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

  const effectiveChallengeId =
    selectedChallengeId ??
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
    { enabled: canUse && effectiveChallengeId != null },
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
      setSelectedChallengeId((current) => current ?? challengeRows.challenges[0]?.id ?? null);
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
        toast.error(errorMessage(err, "Queue action failed."));
      } finally {
        setBusy(null);
      }
    },
    [refreshLive],
  );

  const onSearch = useCallback(async () => {
    if (!effectiveChallengeId || !search.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(await searchTeams(effectiveChallengeId, search.trim()));
    } catch (err) {
      toast.error(errorMessage(err, "Search failed."));
    } finally {
      setSearching(false);
    }
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
  const progressTotal = progress.data
    ? progress.data.waiting +
      progress.data.called +
      progress.data.inProgress +
      progress.data.evaluated +
      progress.data.disqualified +
      progress.data.other
    : 0;
  const evaluatedPercent =
    progress.data && progressTotal > 0
      ? Math.round((progress.data.evaluated / progressTotal) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Judging"
        description="Run a room queue, present teams, save judging reviews and monitor challenge progress."
        actions={
          canAdmin ? (
            <Button variant="outline" asChild>
              <Link href="/queue/rooms">Room admin</Link>
            </Button>
          ) : undefined
        }
      />

      <SectionCard
        title="Room controls"
        description="Select the room and challenge context for the live panel."
        icon={DoorOpenIcon}
        bodyClassName="space-y-4"
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
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

          <div className="space-y-2">
            <Label htmlFor="queue-challenge">Challenge</Label>
            <Select
              value={effectiveChallengeId ? String(effectiveChallengeId) : ""}
              onValueChange={(value) => setSelectedChallengeId(Number(value))}
              disabled={challenges.length === 0}
            >
              <SelectTrigger id="queue-challenge" className="w-full">
                <SelectValue placeholder="Select challenge" />
              </SelectTrigger>
              <SelectContent>
                {challenges.map((challenge) => (
                  <SelectItem key={challenge.id} value={String(challenge.id)}>
                    {challengeName(challenge)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            {isPaused ? "Resume room" : "Pause room"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Waiting" value={view?.next.length ?? 0} hint="Next teams in queue" />
          <StatCard label="Called" value={view?.called.length ?? 0} hint="In waiting area" />
          <StatCard
            label="Pace"
            value={minutesLabel(pace.data?.effectiveMinutesPerTeam)}
            hint={pace.data?.autoAdjusted ? "Auto-adjusted to finish on time" : "Target per team"}
          />
          <StatCard
            label="Status"
            value={isPaused ? "Paused" : "Live"}
            hint={view?.room.location ?? view?.room.slug ?? undefined}
          />
        </div>
      </SectionCard>

      <Tabs defaultValue="panel" className="space-y-4">
        <TabsList>
          <TabsTrigger value="panel">Panel</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
        </TabsList>

        <TabsContent value="panel" className="space-y-0">
          {roomsLoading || roomView.loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <Spinner />
            </div>
          ) : !view ? (
            <EmptyState
              icon={DoorOpenIcon}
              title="No room selected"
              description="Create or select a judging room before operating the queue."
            />
          ) : (
            <div className="grid gap-5 xl:grid-cols-12">
              <div className="space-y-5 xl:col-span-4">
                <QueuePanel
                  view={view}
                  canOperate={canOperate}
                  busy={busy}
                  onCallNext={() =>
                    activeRoomId &&
                    mutate(
                      "call-next",
                      () => callNext(activeRoomId, crypto.randomUUID()),
                      "Next team called.",
                    )
                  }
                  onEntryAction={(entry, action, body, label) =>
                    mutate(
                      `${action}-${entry.id}`,
                      () => entryAction(entry.id, action, body, crypto.randomUUID()),
                      label,
                    )
                  }
                />
                <SearchPanel
                  query={search}
                  results={searchResults}
                  searching={searching}
                  disabled={!effectiveChallengeId}
                  canOperate={canOperate || canJudge}
                  roomId={activeRoomId}
                  onQuery={setSearch}
                  onSearch={onSearch}
                  onManualCall={(entry, targetStatus) =>
                    activeRoomId &&
                    mutate(
                      `manual-${entry.id}`,
                      () =>
                        entryAction(
                          entry.id,
                          "manual-call",
                          { targetStatus, roomId: activeRoomId, reason: "Manual search recovery" },
                          crypto.randomUUID(),
                        ),
                      targetStatus === "in_room" ? "Team brought into room." : "Team called.",
                    )
                  }
                />
              </div>

              <div className="space-y-5 xl:col-span-8">
                <PresentationPanel
                  entry={active}
                  challenge={activeChallenge}
                  pace={pace.data}
                  canJudge={canJudge}
                  busy={busy}
                  roomId={activeRoomId}
                  onEntryAction={(entry, action, body, label) =>
                    mutate(
                      `${action}-${entry.id}`,
                      () => entryAction(entry.id, action, body, crypto.randomUUID()),
                      label,
                    )
                  }
                />
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="progress" className="space-y-4">
          <SectionCard
            title="Challenge progress"
            description="Operational counts and exports for the selected challenge."
            icon={CheckCircle2Icon}
            action={
              canExport && effectiveChallengeId ? (
                <div className="flex flex-wrap gap-2">
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
                </div>
              ) : undefined
            }
          >
            {progress.loading ? (
              <Spinner />
            ) : !progress.data ? (
              <EmptyState
                icon={CheckCircle2Icon}
                title="No challenge selected"
                description="Select a challenge to see queue progress."
              />
            ) : (
              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="font-medium">
                      {challengeName(activeChallenge, effectiveChallengeId ?? undefined)}
                    </p>
                    <span className="text-muted-foreground text-sm tabular-nums">
                      {evaluatedPercent}% evaluated
                    </span>
                  </div>
                  <Progress value={evaluatedPercent} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <StatCard label="Waiting" value={progress.data.waiting} />
                  <StatCard label="Called" value={progress.data.called} />
                  <StatCard label="In progress" value={progress.data.inProgress} />
                  <StatCard label="Evaluated" value={progress.data.evaluated} />
                  <StatCard label="Disqualified" value={progress.data.disqualified} />
                </div>
              </div>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QueuePanel({
  view,
  canOperate,
  busy,
  onCallNext,
  onEntryAction,
}: {
  view: RoomView;
  canOperate: boolean;
  busy: string | null;
  onCallNext: () => void;
  onEntryAction: (
    entry: QueueEntry,
    action: "notify-enter" | "bring-in" | "requeue" | "no-show" | "skip",
    body: Record<string, unknown> | undefined,
    label: string,
  ) => void;
}) {
  return (
    <SectionCard
      title="Queue"
      description="Call the next team and manage the waiting area."
      icon={BellRingIcon}
      action={
        <Button disabled={!canOperate || busy === "call-next"} onClick={onCallNext}>
          <BellRingIcon className="size-4" />
          Call next
        </Button>
      }
      bodyClassName="space-y-5"
    >
      <QueueList
        title="Called"
        description="Teams already assigned to this room."
        entries={view.called}
        empty="No teams in the waiting area."
        renderActions={(entry) => (
          <>
            <Button
              size="xs"
              variant="outline"
              disabled={busy != null}
              onClick={() =>
                onEntryAction(entry, "notify-enter", undefined, "Entrance notice sent.")
              }
            >
              <SendIcon className="size-3" />
              Notify
            </Button>
            <Button
              size="xs"
              disabled={busy != null}
              onClick={() => onEntryAction(entry, "bring-in", undefined, "Team brought in.")}
            >
              <DoorOpenIcon className="size-3" />
              Bring in
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy != null}
              onClick={() =>
                onEntryAction(
                  entry,
                  "requeue",
                  { position: "bottom", reason: "Returned from waiting area" },
                  "Team returned to the queue.",
                )
              }
            >
              <RotateCcwIcon className="size-3" />
              Requeue
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={busy != null}
              onClick={() =>
                onEntryAction(entry, "no-show", { reason: "No show" }, "No-show recorded.")
              }
            >
              <AlertTriangleIcon className="size-3" />
              No-show
            </Button>
          </>
        )}
      />
      <Separator />
      <QueueList
        title="Next"
        description="Upcoming teams for this room's assigned challenges."
        entries={view.next}
        empty="No waiting teams."
        renderActions={(entry) => (
          <Button
            size="xs"
            variant="outline"
            disabled={busy != null || !canOperate}
            onClick={() =>
              onEntryAction(entry, "skip", { reason: "Skipped by operator" }, "Team skipped.")
            }
          >
            <SkipForwardIcon className="size-3" />
            Skip
          </Button>
        )}
      />
    </SectionCard>
  );
}

function QueueList({
  title,
  description,
  entries,
  empty,
  renderActions,
}: {
  title: string;
  description: string;
  entries: QueueEntry[];
  empty: string;
  renderActions: (entry: QueueEntry) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="text-muted-foreground text-sm text-pretty">{description}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entryLabel(entry)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <QueueStatusBadge status={entry.status} />
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

function SearchPanel({
  query,
  results,
  searching,
  disabled,
  canOperate,
  roomId,
  onQuery,
  onSearch,
  onManualCall,
}: {
  query: string;
  results: QueueSearchResult[];
  searching: boolean;
  disabled: boolean;
  canOperate: boolean;
  roomId: number | null;
  onQuery: (value: string) => void;
  onSearch: () => void;
  onManualCall: (entry: QueueSearchResult, targetStatus: "called" | "in_room") => void;
}) {
  return (
    <SectionCard
      title="Find team"
      description="Recover a specific team by project, repo id or queue entry id."
      icon={SearchIcon}
    >
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="queue-search">Search</Label>
          <Input
            id="queue-search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void onSearch();
            }}
            placeholder="Project name, repo id or entry id"
            disabled={disabled}
          />
        </div>
        <Button
          className="mt-8"
          variant="outline"
          disabled={disabled || searching}
          onClick={onSearch}
        >
          <SearchIcon className="size-4" />
          Search
        </Button>
      </div>
      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((entry) => (
            <li key={entry.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entryLabel(entry)}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <QueueStatusBadge status={entry.status} />
                    {entry.has_review && (
                      <StatusBadge
                        tone={entry.review_status === "submitted" ? "success" : "warning"}
                      >
                        {entry.review_status ?? "review"}
                      </StatusBadge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!canOperate || roomId == null}
                    onClick={() => onManualCall(entry, "called")}
                  >
                    Call
                  </Button>
                  <Button
                    size="xs"
                    disabled={!canOperate || roomId == null}
                    onClick={() => onManualCall(entry, "in_room")}
                  >
                    Bring in
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function PresentationPanel({
  entry,
  challenge,
  pace,
  canJudge,
  busy,
  roomId,
  onEntryAction,
}: {
  entry: QueueEntry | null;
  challenge: Challenge | null;
  pace: RoomPace | null;
  canJudge: boolean;
  busy: string | null;
  roomId: number | null;
  onEntryAction: (
    entry: QueueEntry,
    action: "start" | "complete" | "send-back",
    body: Record<string, unknown> | undefined,
    label: string,
  ) => void;
}) {
  return (
    <>
      <SectionCard
        title="Presentation"
        description="Current team in the room and timer target."
        icon={TimerIcon}
        action={entry ? <QueueStatusBadge status={entry.status} /> : undefined}
      >
        {!entry ? (
          <EmptyState
            icon={DoorOpenIcon}
            title="No team in the room"
            description="Bring in a called team to start presentation and judging."
          />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-2xl font-semibold text-balance">
                  {entryLabel(entry)}
                </h2>
                <p className="text-muted-foreground text-sm">
                  {challengeName(challenge, entry.challenge_id)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground text-xs font-medium uppercase">Target time</p>
                <p className="text-xl font-semibold tabular-nums">
                  {minutesLabel(pace?.effectiveMinutesPerTeam)}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!canJudge || entry.status !== "in_room" || busy != null}
                onClick={() => onEntryAction(entry, "start", undefined, "Presentation started.")}
              >
                <PlayIcon className="size-4" />
                Start
              </Button>
              <Button
                variant="outline"
                disabled={!canJudge || entry.status !== "presenting" || busy != null}
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
                Send back
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      <ReviewForm entry={entry} challenge={challenge} roomId={roomId} canJudge={canJudge} />
    </>
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

  useEffect(() => {
    if (!entry || !canJudge) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      getReview(entry.id),
      getSessions(entry.id),
      openSession(entry.id, roomId ?? undefined).catch(() => null),
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
      void closeSession(entry.id).catch(() => undefined);
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
          <Button disabled={!canJudge || saving || loading} onClick={() => save(true)}>
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
      {question.kind === "scale" || question.kind === "integer" || question.kind === "float" ? (
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
