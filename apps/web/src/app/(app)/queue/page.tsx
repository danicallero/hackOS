"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  ArrowRightIcon,
  Building2Icon,
  PauseIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  TicketIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useLiveQuery } from "@/hooks/use-event-source";
import { ApiError, api } from "@/lib/api";
import {
  enqueueAllChallengeQueues,
  getAllRoomViews,
  getRoomAssignments,
  type RoomAssignments,
  type RoomView,
} from "@/lib/queue";
import { useSessionContext } from "@/lib/session";
import { cn } from "@/lib/utils";
import { type Challenge, textForDisplay } from "../challenges/shared";

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
  const [challenges, setChallenges] = useState<Challenge[]>([]);
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
      setChallenges([]);
      return;
    }
    try {
      const challengePromise = api.get<{ challenges: Challenge[] }>("/api/challenges");
      const assignmentPromise =
        rooms.length > 0 ? Promise.all(rooms.map((room) => getRoomAssignments(room.room.id))) : [];
      const [assignmentRows, challengeRows] = await Promise.all([
        assignmentPromise,
        challengePromise,
      ]);
      const nextAssignments: Record<number, RoomAssignments> = {};
      for (const item of assignmentRows as RoomAssignments[]) nextAssignments[item.roomId] = item;
      setRoomAssignments(nextAssignments);
      setChallenges(challengeRows.challenges);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load operations details.");
    }
  }, [canAdmin, rooms]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const summary = useMemo(() => {
    const active = rooms.filter((room) => room.active).length;
    const called = rooms.reduce((acc, room) => acc + room.called.length, 0);
    const next = rooms.reduce((acc, room) => acc + room.next.length, 0);
    const paused = rooms.filter((room) => room.state?.is_paused).length;
    return { active, called, next, paused };
  }, [rooms]);

  const eligibleChallenges = useMemo(
    () => challenges.filter((challenge) => (challenge.devpost_tags?.length ?? 0) > 0),
    [challenges],
  );

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
    <div className="space-y-6">
      <PageHeader
        title="Queue operations"
        description="Global room queue state, progress, and manual queue generation."
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Rooms" value={rooms.length} icon={Building2Icon} />
        <StatCard label="Active rooms" value={summary.active} icon={ShieldCheckIcon} />
        <StatCard label="Called teams" value={summary.called} icon={TicketIcon} />
        <StatCard label="Next teams" value={summary.next} icon={ArrowRightIcon} />
        <StatCard label="Paused rooms" value={summary.paused} icon={PauseIcon} />
      </div>

      {canAdmin && (
        <SectionCard
          title="Queue sources"
          description="Challenges with DevPost tags are eligible for queue generation."
          icon={TicketIcon}
          bodyClassName="space-y-3"
        >
          {eligibleChallenges.length === 0 ? (
            <p className="text-muted-foreground text-sm">No tagged challenges yet.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {eligibleChallenges.map((challenge) => (
                <Card key={challenge.id} className="gap-3 p-4 shadow-none">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{textForDisplay(challenge.title)}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {challenge.devpost_tags?.join(" · ")}
                      </p>
                    </div>
                    <StatusBadge tone="success">Tagged</StatusBadge>
                  </div>
                  <Separator />
                  <div className="flex flex-wrap gap-1.5">
                    {challenge.devpost_tags?.map((tag) => (
                      <StatusBadge key={tag} tone="neutral">
                        {tag}
                      </StatusBadge>
                    ))}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard
        title="Room queues"
        description="Every room, its current queue snapshot, and its assignment state."
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
          <div className="grid gap-4 xl:grid-cols-2">
            {rooms.map((room) => (
              <RoomQueueCard
                key={room.room.id}
                room={room}
                assignments={roomAssignments[room.room.id] ?? null}
                showAssignments={canAdmin}
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
  showAssignments,
}: {
  room: RoomView;
  assignments: RoomAssignments | null;
  showAssignments: boolean;
}) {
  const roomState = room.state;
  const hasActive = room.active != null;

  return (
    <Card className="gap-0 overflow-hidden p-0 shadow-none">
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold">{room.room.name}</h3>
            <StatusBadge tone={roomState?.is_paused ? "warning" : "success"}>
              {roomState?.is_paused ? "Paused" : "Live"}
            </StatusBadge>
          </div>
          <p className="text-muted-foreground text-sm">
            {room.room.location ?? "No location"} · {room.room.slug}
          </p>
        </div>
        <StatusBadge tone={room.room.status === "active" ? "success" : "neutral"}>
          {room.room.status}
        </StatusBadge>
      </div>

      <Separator />

      <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
        <MiniMetric label="Active" value={hasActive ? "1" : "0"} />
        <MiniMetric label="Called" value={String(room.called.length)} />
        <MiniMetric label="Next" value={String(room.next.length)} />
      </div>

      <div className="space-y-3 px-5 pb-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <InfoRow
            label="Capacity"
            value={roomState ? String(roomState.max_in_waiting_area) : "—"}
          />
          <InfoRow
            label="Pace"
            value={roomState ? `${roomState.desired_minutes_per_team} min/team` : "—"}
          />
        </div>
        {room.active && (
          <QueueEntryLine
            label="Active"
            value={room.active.repo_name ?? `Repo #${room.active.repo_id}`}
          />
        )}
        {room.called.length > 0 && (
          <QueueEntryLine
            label="Called"
            value={room.called
              .map((entry) => entry.repo_name ?? `Repo #${entry.repo_id}`)
              .join(", ")}
          />
        )}
        {room.next.length > 0 && (
          <QueueEntryLine
            label="Next"
            value={room.next.map((entry) => entry.repo_name ?? `Repo #${entry.repo_id}`).join(", ")}
          />
        )}
        {showAssignments && assignments && (
          <div className="space-y-2">
            <Separator />
            <div className="grid gap-3 sm:grid-cols-2">
              <AssignmentBlock
                title="Challenges"
                items={assignments.challenges.map((item) => item.title)}
                emptyText="No challenges assigned"
              />
              <AssignmentBlock
                title="Judges"
                items={assignments.judges.map((item) => item.email)}
                emptyText="No judges assigned"
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function QueueEntryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function AssignmentBlock({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: string[];
  emptyText: string;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <StatusBadge key={item} tone="neutral">
              {item}
            </StatusBadge>
          ))}
        </div>
      )}
    </div>
  );
}
