"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BellRingIcon,
  Building2Icon,
  DoorOpenIcon,
  RotateCcwIcon,
  SearchIcon,
  TicketIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { type SseEnvelope, useLiveQuery } from "@/hooks/use-event-source";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
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
import { textForDisplay } from "../challenges/shared";
import { GenerateQueuesAction } from "./generate-queues-action";

export default function QueueOperationsPage() {
  const { t } = useLocale();
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
  const [arrivalHints, setArrivalHints] = useState(false);
  const arrivalHintsRef = useRef(false);
  useEffect(() => {
    const stored = window.localStorage.getItem("queue-ops-arrival-hints") === "1";
    setArrivalHints(stored);
    arrivalHintsRef.current = stored;
  }, []);
  const toggleArrivalHints = useCallback((checked: boolean) => {
    setArrivalHints(checked);
    arrivalHintsRef.current = checked;
    window.localStorage.setItem("queue-ops-arrival-hints", checked ? "1" : "0");
  }, []);

  const announceTeamEnter = useCallback(
    (event: SseEnvelope) => {
      if (event.type === EVENTS.QUEUE_TEAM_CALLED) {
        if (!arrivalHintsRef.current) return;
        if (!event.data || typeof event.data !== "object") return;
        const data = event.data as Record<string, unknown>;
        const team = typeof data.teamName === "string" ? data.teamName : t("challengeFallback");
        const room = typeof data.roomName === "string" ? data.roomName : t("noLocation");
        toast.info(t("teamShouldArrive", { team, room }), { duration: 10_000 });
        return;
      }
      if (event.type !== EVENTS.QUEUE_NOTIFY_ENTER || !event.data || typeof event.data !== "object")
        return;
      const data = event.data as Record<string, unknown>;
      const team = typeof data.team_name === "string" ? data.team_name : t("challengeFallback");
      const room = typeof data.room_name === "string" ? data.room_name : null;
      toast.info(room ? `${team} · ${room}` : team, {
        description: t("teamAskedToEnter"),
        duration: 10_000,
      });
    },
    [t],
  );

  const roomViews = useLiveQuery<RoomView[]>(
    () => getAllRoomViews(),
    "/api/queue/stream",
    [
      EVENTS.QUEUE_ENTRY_CHANGED,
      EVENTS.QUEUE_ROOM_CHANGED,
      EVENTS.QUEUE_NOTIFY_ENTER,
      EVENTS.QUEUE_TEAM_CALLED,
    ],
    { enabled: canUse, onEvent: announceTeamEnter },
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
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadOperationsDetails"));
    }
  }, [canAdmin, rooms, t]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  const onGenerate = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enqueueAllChallengeQueues(crypto.randomUUID());
      toast.success(
        t("queuesGenerated", { inserted: result.inserted, challenges: result.challenges.length }),
      );
      roomViews.refetch();
      await loadAdminData();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotGenerateQueues"));
    } finally {
      setBusy(false);
    }
  }, [loadAdminData, roomViews, t]);

  if (!canUse) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("queueOperations")} />
        <EmptyState
          icon={TicketIcon}
          title={t("noAccessQueueOps")}
          description={t("queueOpsAccessDeniedDesc")}
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
        <PageHeader title={t("queueOperations")} />
        <EmptyState
          icon={TicketIcon}
          title={t("couldNotLoadQueueOps")}
          description={roomViews.error instanceof Error ? roomViews.error.message : t("tryAgain")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-wide>
      <PageHeader
        title={t("queueOperations")}
        primaryAction={
          canAdmin ? (
            <GenerateQueuesAction busy={busy} onGenerate={() => void onGenerate()} />
          ) : undefined
        }
        secondaryActions={
          <>
            <label
              className="text-muted-foreground flex items-center gap-2 text-sm"
              htmlFor="arrival-hints"
              title={t("arrivalHintsDescription")}
            >
              <Switch
                id="arrival-hints"
                checked={arrivalHints}
                onCheckedChange={toggleArrivalHints}
              />
              {t("arrivalHints")}
            </label>
            <Button variant="outline" asChild>
              <Link href="/judging">
                <ArrowRightIcon className="size-4" />
                {t("openJudging")}
              </Link>
            </Button>
          </>
        }
      />

      <SectionCard title={t("roomQueues")} icon={Building2Icon} bodyClassName="space-y-4">
        {rooms.length === 0 ? (
          <EmptyState
            icon={Building2Icon}
            title={t("noRoomsYet")}
            description={t("noRoomsYetDescription")}
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
  const { t } = useLocale();

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
          toast.error(err instanceof ApiError ? err.message : t("teamSearchFailed"));
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [challengeId, query, t]);

  const mutate = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
      setQuery("");
      setResults([]);
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("queueActionFailed"));
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
                {textForDisplay("title" in challenge ? challenge.title : "") ||
                  t("challengeFallback")}
              </StatusBadge>
            )}
            <StatusBadge tone={roomState?.is_paused ? "warning" : "success"}>
              {roomState?.is_paused ? t("paused") : t("live")}
            </StatusBadge>
          </div>
          <p className="text-muted-foreground text-xs">
            {room.room.location ?? t("noLocation")} · {room.room.slug}
          </p>
        </div>
      </div>

      <Separator />

      <details className="group">
        <summary className="hover:bg-muted/50 flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex min-w-0 items-center gap-4 text-sm">
            <span className="min-w-0">
              <span className="text-muted-foreground block text-xs">{t("presenting")}</span>
              <span className="block truncate font-medium">
                {room.active ? entryLabel(room.active, t) : t("noTeamPresenting")}
              </span>
            </span>
            <span className="min-w-0">
              <span className="text-muted-foreground block text-xs">
                {t("calledTeams", { count: room.called.length })}
              </span>
              <span className="block truncate font-medium">
                {room.called.length > 0
                  ? room.called.map((entry) => entryLabel(entry, t)).join(", ")
                  : t("noTeamsCalled")}
              </span>
            </span>
          </div>
          <span className="text-primary shrink-0 text-sm font-medium group-open:hidden">
            {t("manageRoom")}
          </span>
          <span className="text-muted-foreground hidden shrink-0 text-sm group-open:inline">
            {t("close")}
          </span>
        </summary>

        <div className="space-y-2 border-t px-3.5 pb-3.5 pt-2.5">
          <QueueEntryBlock
            label={t("presenting")}
            entry={room.active}
            empty={t("noTeamPresenting")}
            onSelect={setSelectedEntry}
          />

          <QueueGroup
            label={t("calledTeams", { count: room.called.length })}
            entries={room.called}
            empty={t("noTeamsCalled")}
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
                      t("teamRenotified"),
                    )
                  }
                >
                  <BellRingIcon className="size-4" />
                  {t("renotify")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canOperate || busy === `bring-${entry.id}`}
                  onClick={() =>
                    void mutate(
                      `bring-${entry.id}`,
                      () => entryAction(entry.id, "bring-in", undefined, crypto.randomUUID()),
                      t("teamBroughtIn"),
                    )
                  }
                >
                  <DoorOpenIcon className="size-4" />
                  {t("bringIn")}
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
                      t("teamRequeued"),
                    )
                  }
                >
                  <RotateCcwIcon className="size-4" />
                  {t("requeue")}
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
                      t("teamMarkedAbsent"),
                    )
                  }
                >
                  <AlertTriangleIcon className="size-4" />
                  {t("absent")}
                </Button>
              </>
            )}
          />

          <QueueEntryBlock
            label={t("nextAtTop")}
            entry={nextEntry}
            empty={t("noWaitingTeam")}
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
                    t("teamAddedWaiting"),
                  )
                }
              >
                <DoorOpenIcon className="size-4" />
                {t("addWaiting")}
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
                placeholder={t("searchProjectPlaceholder")}
                className="h-8 pl-8 text-sm"
              />
            </div>
            {query.trim() && (
              <div className="space-y-1.5">
                {searching && results.length === 0 ? (
                  <Spinner className="size-4" />
                ) : results.length === 0 ? (
                  <p className="text-muted-foreground text-xs">{t("noTeamsFound")}</p>
                ) : (
                  results.slice(0, 5).map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
                    >
                      <TeamButton entry={entry} onSelect={setSelectedEntry} />
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canOperate || busy === `top-${entry.id}`}
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
                              t("teamMovedTop"),
                            )
                          }
                        >
                          {t("top")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={!canOperate || busy === `waiting-${entry.id}`}
                          onClick={() =>
                            void mutate(
                              `waiting-${entry.id}`,
                              () =>
                                entryAction(
                                  entry.id,
                                  "manual-call",
                                  {
                                    targetStatus: "called",
                                    roomId: room.room.id,
                                    reason: "Queue operations: sent to waiting room",
                                  },
                                  crypto.randomUUID(),
                                ),
                              t("teamAddedWaiting"),
                            )
                          }
                        >
                          <DoorOpenIcon className="size-4" />
                          {t("waiting")}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </details>

      <TeamMembersModal
        entry={selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />
    </Card>
  );
}

function entryLabel(entry: QueueEntry, t: Translate): string {
  return entry.repo_name ?? t("repoNumber", { id: entry.repo_id });
}

function TeamButton({
  entry,
  onSelect,
}: {
  entry: QueueEntry;
  onSelect: (entry: QueueEntry) => void;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className="min-w-0 text-left hover:underline"
      onClick={() => onSelect(entry)}
    >
      <span className="block truncate text-sm font-medium">{entryLabel(entry, t)}</span>
      <span className="text-muted-foreground block text-xs tabular-nums">
        {t("entryNumber", { id: entry.id })}
      </span>
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
  actions?: (entry: QueueEntry) => React.ReactNode;
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
          {actions && <div className="flex flex-wrap gap-1.5">{actions(entry)}</div>}
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
  const { t } = useLocale();
  return (
    <Modal
      open={entry != null}
      onOpenChange={onOpenChange}
      title={entry ? entryLabel(entry, t) : t("teamMembers")}
      size="md"
    >
      {members.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noMembersLinked")}</p>
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
