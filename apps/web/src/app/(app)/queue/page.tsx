"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BellRingIcon,
  Building2Icon,
  DoorOpenIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  TicketIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError } from "@/lib/api";
import {
  enqueueAllChallengeQueues,
  entryAction,
  getAllRoomViews,
  getRoomAssignments,
  type QueueEntry,
  type QueueSearchResult,
  type RoomAssignments,
  type RoomView,
  searchTeams,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { textForDisplay } from "../challenges/shared";

export default function QueueOperationsPage() {
  const { can, canAny } = useSessionContext();
  const canUse = canAny(
    CAPABILITIES.QUEUE_OPERATE,
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.JUDGE_PANEL,
  );
  const canAdmin = can(CAPABILITIES.QUEUE_ADMIN);
  const [busy, setBusy] = useState(false);
  const [roomAssignments, setRoomAssignments] = useState<Record<number, RoomAssignments | null>>(
    {},
  );
  const roomViews = useLiveQuery<RoomView[]>(
    () => getAllRoomViews(),
    "/api/tv/stream",
    [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED, EVENTS.QUEUE_NOTIFY_ENTER],
    { enabled: canUse },
  );

  const rooms = roomViews.data ?? [];

  const loadAdminData = useCallback(async () => {
    if (!canAdmin) {
      setRoomAssignments({});
      return;
    }
    try {
      const assignmentPromise =
        rooms.length > 0 ? Promise.all(rooms.map((room) => getRoomAssignments(room.room.id))) : [];
      const assignmentRows = await assignmentPromise;
      const nextAssignments: Record<number, RoomAssignments> = {};
      for (const item of assignmentRows as RoomAssignments[]) nextAssignments[item.roomId] = item;
      setRoomAssignments(nextAssignments);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load operations details.");
    }
  }, [canAdmin, rooms]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enqueueAllChallengeQueues(crypto.randomUUID());
      toast.success(
        `Generated ${result.inserted} queue entr${result.inserted === 1 ? "y" : "ies"} across ${result.challenges.length} challenge${result.challenges.length === 1 ? "" : "s"}.`,
      );
      roomViews.refetch();
      await loadAdminData();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not generate queues.");
    } finally {
      setBusy(false);
    }
  }, [loadAdminData, roomViews]);

  if (!canUse) {
    return (
      <div className="space-y-6">
        <PageHeader title="Queue operations" />
        <EmptyState
          icon={TicketIcon}
          title="You can't access queue operations"
          description="Queue operations requires queue or judging access."
        />
      </div>
    );
  }

  if (roomViews.loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (roomViews.error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Queue operations" />
        <EmptyState
          icon={TicketIcon}
          title="Could not load queue operations"
          description={roomViews.error instanceof Error ? roomViews.error.message : "Try again."}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title="Queue operations"
        description="Unified room queues and manual recovery actions."
        actions={
          <>
            {canAdmin && (
              <Button onClick={() => void onGenerate()} disabled={busy}>
                <RefreshCwIcon className={cn("size-4", busy && "animate-spin")} />
                Generate queues
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link href="/judging">
                <ArrowRightIcon className="size-4" />
                Open judging
              </Link>
            </Button>
          </>
        }
      />

      <SectionCard
        title="Room queues"
        description="Presenting teams, called teams, next queue head, and fast operator actions."
        icon={Building2Icon}
        bodyClassName="space-y-4"
      >
        {rooms.length === 0 ? (
          <EmptyState
            icon={Building2Icon}
            title="No rooms yet"
            description="Create rooms in Administration to start building queue views."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {rooms.map((room) => (
              <RoomQueueCard
                key={room.room.id}
                room={room}
                assignments={roomAssignments[room.room.id] ?? null}
                canOperate={can(CAPABILITIES.QUEUE_OPERATE) || canAdmin}
                onChanged={() => {
                  roomViews.refetch();
                  void loadAdminData();
                }}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function RoomQueueCard({
  room,
  assignments,
  canOperate,
  onChanged,
}: {
  room: RoomView;
  assignments: RoomAssignments | null;
  canOperate: boolean;
  onChanged: () => void;
}) {
  const roomState = room.state;
  const [selectedEntry, setSelectedEntry] = useState<QueueEntry | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueueSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const challenge = room.challenge ?? assignments?.challenges[0] ?? null;
  const challengeId = challenge
    ? "id" in challenge
      ? challenge.id
      : challenge.challenge_id
    : null;
  const nextEntry = room.next[0] ?? null;

  useEffect(() => {
    const term = query.trim();
    if (!challengeId || !term) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const hits = await searchTeams(challengeId, term);
        if (!cancelled) setResults(hits);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof ApiError ? err.message : "Team search failed.");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [challengeId, query]);

  const mutate = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      setQuery("");
      setResults([]);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Queue action failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="gap-0 overflow-hidden p-0 shadow-none">
      <div className="flex items-start justify-between gap-2 px-3.5 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{room.room.name}</h3>
            {challenge && (
              <StatusBadge tone="neutral">
                {textForDisplay("title" in challenge ? challenge.title : "") || "Challenge"}
              </StatusBadge>
            )}
            <StatusBadge tone={roomState?.is_paused ? "warning" : "success"}>
              {roomState?.is_paused ? "Paused" : "Live"}
            </StatusBadge>
          </div>
          <p className="text-muted-foreground text-xs">
            {room.room.location ?? "No location"} · {room.room.slug}
          </p>
        </div>
      </div>

      <Separator />

      <div className="space-y-2 px-3.5 pb-3.5 pt-2.5">
        <QueueEntryBlock
          label="Presenting"
          entry={room.active}
          empty="No team presenting."
          onSelect={setSelectedEntry}
          actions={(entry) => (
            <Button
              size="sm"
              variant="outline"
              disabled={!canOperate || busy === `requeue-${entry.id}`}
              onClick={() =>
                void mutate(
                  `requeue-${entry.id}`,
                  () =>
                    entryAction(
                      entry.id,
                      "send-back",
                      { reason: "Queue operations: sent back" },
                      crypto.randomUUID(),
                    ),
                  "Team sent back to the waiting area.",
                )
              }
            >
              <RotateCcwIcon className="size-4" />
              Requeue
            </Button>
          )}
        />

        <QueueGroup
          label={`Called teams (${room.called.length})`}
          entries={room.called}
          empty="No teams called."
          onSelect={setSelectedEntry}
          actions={(entry) => (
            <>
              <Button
                size="sm"
                disabled={!canOperate || busy === `notify-${entry.id}`}
                onClick={() =>
                  void mutate(
                    `notify-${entry.id}`,
                    () => entryAction(entry.id, "notify-enter", undefined, crypto.randomUUID()),
                    "Team renotified.",
                  )
                }
              >
                <BellRingIcon className="size-4" />
                Renotify
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canOperate || busy === `bring-${entry.id}`}
                onClick={() =>
                  void mutate(
                    `bring-${entry.id}`,
                    () => entryAction(entry.id, "bring-in", undefined, crypto.randomUUID()),
                    "Team brought into room.",
                  )
                }
              >
                <DoorOpenIcon className="size-4" />
                Bring in
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canOperate || busy === `requeue-${entry.id}`}
                onClick={() =>
                  void mutate(
                    `requeue-${entry.id}`,
                    () =>
                      entryAction(
                        entry.id,
                        "requeue",
                        { position: "bottom", reason: "Queue operations: requeued" },
                        crypto.randomUUID(),
                      ),
                    "Team requeued.",
                  )
                }
              >
                <RotateCcwIcon className="size-4" />
                Requeue
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canOperate || busy === `noshow-${entry.id}`}
                onClick={() =>
                  void mutate(
                    `noshow-${entry.id}`,
                    () =>
                      entryAction(
                        entry.id,
                        "no-show",
                        { reason: "Queue operations: absent" },
                        crypto.randomUUID(),
                      ),
                    "Team marked absent.",
                  )
                }
              >
                <AlertTriangleIcon className="size-4" />
                Absent
              </Button>
            </>
          )}
        />

        <QueueEntryBlock
          label="Next at top"
          entry={nextEntry}
          empty="No waiting team."
          onSelect={setSelectedEntry}
          actions={(entry) => (
            <Button
              size="sm"
              variant="outline"
              disabled={!canOperate || busy === `call-${entry.id}`}
              onClick={() =>
                void mutate(
                  `call-${entry.id}`,
                  () =>
                    entryAction(
                      entry.id,
                      "manual-call",
                      {
                        targetStatus: "called",
                        roomId: room.room.id,
                        reason: "Queue operations: manually called next",
                      },
                      crypto.randomUUID(),
                    ),
                  "Team added to the waiting room.",
                )
              }
            >
              <DoorOpenIcon className="size-4" />
              Add waiting
            </Button>
          )}
        />

        <div className="space-y-1.5 rounded-md border p-2.5">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={!canOperate || !challengeId}
              placeholder="Add to top: search project, repo or entry id"
              className="h-8 pl-8 text-sm"
            />
          </div>
          {query.trim() && (
            <div className="space-y-1.5">
              {searching && results.length === 0 ? (
                <Spinner className="size-4" />
              ) : results.length === 0 ? (
                <p className="text-muted-foreground text-xs">No teams found.</p>
              ) : (
                results.slice(0, 5).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
                  >
                    <TeamButton entry={entry} onSelect={setSelectedEntry} />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={busy === `top-${entry.id}`}
                      onClick={() =>
                        void mutate(
                          `top-${entry.id}`,
                          () =>
                            entryAction(
                              entry.id,
                              "move-top",
                              { reason: "Queue operations: moved to top" },
                              crypto.randomUUID(),
                            ),
                          "Team moved to the top of the queue.",
                        )
                      }
                    >
                      Top
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <TeamMembersModal
        entry={selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />
    </Card>
  );
}

function entryLabel(entry: QueueEntry): string {
  return entry.repo_name ?? `Repo #${entry.repo_id}`;
}

function TeamButton({
  entry,
  onSelect,
}: {
  entry: QueueEntry;
  onSelect: (entry: QueueEntry) => void;
}) {
  return (
    <button
      type="button"
      className="min-w-0 text-left hover:underline"
      onClick={() => onSelect(entry)}
    >
      <span className="block truncate text-sm font-medium">{entryLabel(entry)}</span>
      <span className="text-muted-foreground block text-xs tabular-nums">Entry #{entry.id}</span>
    </button>
  );
}

function QueueEntryBlock({
  label,
  entry,
  empty,
  onSelect,
  actions,
}: {
  label: string;
  entry: QueueEntry | null;
  empty: string;
  onSelect: (entry: QueueEntry) => void;
  actions: (entry: QueueEntry) => React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border p-2.5">
      <div className="text-muted-foreground text-[0.65rem] font-medium tracking-wide uppercase">
        {label}
      </div>
      {entry ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <TeamButton entry={entry} onSelect={onSelect} />
            <QueueStatusBadge status={entry.status} />
          </div>
          <div className="flex flex-wrap gap-1.5">{actions(entry)}</div>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">{empty}</p>
      )}
    </div>
  );
}

function QueueGroup({
  label,
  entries,
  empty,
  onSelect,
  actions,
}: {
  label: string;
  entries: QueueEntry[];
  empty: string;
  onSelect: (entry: QueueEntry) => void;
  actions: (entry: QueueEntry) => React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 rounded-md border p-2.5">
      <div className="text-muted-foreground text-[0.65rem] font-medium tracking-wide uppercase">
        {label}
      </div>
      {entries.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <TeamButton entry={entry} onSelect={onSelect} />
                <QueueStatusBadge status={entry.status} />
              </div>
              <div className="flex flex-wrap gap-1.5">{actions(entry)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamMembersModal({
  entry,
  onOpenChange,
}: {
  entry: QueueEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  const members = entry?.repo_members ?? [];
  return (
    <Modal
      open={entry != null}
      onOpenChange={onOpenChange}
      title={entry ? entryLabel(entry) : "Team members"}
      description="Team members"
      size="md"
    >
      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">No members linked to this team.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {members.map((member) => {
            const name = [member.name, member.surname].filter(Boolean).join(" ").trim();
            return (
              <li key={`${member.userId}:${member.email}`} className="px-3 py-2">
                <p className="text-sm font-medium">{name || member.email}</p>
                {name && <p className="text-muted-foreground text-sm">{member.email}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
