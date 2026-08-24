"use client";

import {
  BellRingIcon,
  CheckCircle2Icon,
  DoorOpenIcon,
  EllipsisIcon,
  ListEndIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { StatusBadge } from "@/components/common/status-badge";
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
import { Surface } from "@/components/ui/surface";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import {
  acknowledgeOperatorArrival,
  entryAction,
  moveQueueEntryToPosition,
  type OperatorArrivalAck,
  type QueueEntry,
  type RoomView,
} from "@/lib/queue";
import { textForDisplay } from "../challenges/shared";
import {
  filterOperatorRows,
  operatorQueueStats,
  operatorRowsForRooms,
  sortOperatorRows,
} from "./operator-console-model";

type OperatorAction = "acknowledge" | "notify-enter" | "manual-call" | "requeue" | "absent" | "top";

/**
 * The operator's default view is room-first. The primary action is a shared
 * door note ("they're here"); queue manipulation is intentionally behind the
 * overflow menu because adding teams to waiting is an exception, not the
 * normal arrival workflow.
 */
export function QueueOperatorConsole({
  rooms,
  arrivalAcks,
  canOperate,
  onChanged,
}: {
  rooms: RoomView[];
  arrivalAcks: OperatorArrivalAck[];
  canOperate: boolean;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const acknowledgedIds = useMemo(
    () => new Set(arrivalAcks.map((ack) => ack.entryId)),
    [arrivalAcks],
  );
  const activeRooms = useMemo(() => rooms.filter((room) => !room.state?.is_paused), [rooms]);
  const allRows = useMemo(
    () => sortOperatorRows(operatorRowsForRooms(activeRooms, "all")),
    [activeRooms],
  );
  const matchingRows = useMemo(() => filterOperatorRows(allRows, query), [allRows, query]);
  const matchingEntryIds = useMemo(
    () => new Set(matchingRows.map((row) => row.entry.id)),
    [matchingRows],
  );
  const stats = useMemo(() => operatorQueueStats(activeRooms), [activeRooms]);

  const runAction = async (
    entry: QueueEntry,
    action: OperatorAction,
    roomId?: number,
  ): Promise<void> => {
    const key = `${action}-${entry.id}`;
    setBusy(key);
    try {
      if (action === "acknowledge") {
        await acknowledgeOperatorArrival(entry.id, crypto.randomUUID());
        toast.success(t("queueArrivalAcknowledged"));
      } else if (action === "notify-enter") {
        await entryAction(entry.id, "notify-enter", undefined, crypto.randomUUID());
        toast.success(t("entranceNoticeSent"));
      } else if (action === "manual-call") {
        if (!roomId) return;
        await entryAction(
          entry.id,
          "manual-call",
          {
            targetStatus: "called",
            roomId,
            reason: "Queue operations: manually added to waiting room",
          },
          crypto.randomUUID(),
        );
        toast.success(t("teamAddedWaiting"));
      } else if (action === "requeue") {
        if (entry.status === "waiting") {
          await moveQueueEntryToPosition(
            entry.id,
            999_999,
            "Queue operations: sent to end",
            crypto.randomUUID(),
          );
        } else {
          await entryAction(
            entry.id,
            "requeue",
            { position: "bottom", reason: "Queue operations: sent to end" },
            crypto.randomUUID(),
          );
        }
        toast.success(t("teamRequeued"));
      } else if (action === "absent") {
        await entryAction(
          entry.id,
          "no-show",
          { reason: "Queue operations: absent" },
          crypto.randomUUID(),
        );
        toast.success(t("teamMarkedAbsent"));
      } else {
        await entryAction(
          entry.id,
          "move-top",
          { reason: "Queue operations: prioritised" },
          crypto.randomUUID(),
        );
        toast.success(t("teamMovedTop"));
      }
      onChanged();
    } catch (err) {
      toast.error(
        action === "acknowledge"
          ? t("queueArrivalActionFailed")
          : err instanceof ApiError
            ? err.message
            : t("queueActionFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const roomMatches = (room: RoomView): boolean => {
    if (!query.trim()) return true;
    return [room.active, ...room.called, ...room.next].some(
      (entry) => entry && matchingEntryIds.has(entry.id),
    );
  };
  const visibleRooms = activeRooms.filter(roomMatches);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("queueCalledNow")} value={stats.called} icon={BellRingIcon} />
        <StatCard label={t("queueWaitingTeams")} value={stats.waiting} icon={UsersIcon} />
        <StatCard label={t("queueInRooms")} value={stats.presenting} icon={DoorOpenIcon} />
        <StatCard label={t("queueLiveRooms")} value={stats.activeRooms} icon={DoorOpenIcon} />
      </div>

      <Surface padding="compact" className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="type-section-title">{t("queueOperatorBoard")}</h2>
              <StatusBadge tone="success">{t("queueLiveUpdates")}</StatusBadge>
            </div>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
              {t("queueOperatorBoardDescription")}
            </p>
          </div>
          <div className="w-full md:max-w-80">
            <Label htmlFor="queue-operator-search">{t("queueSearchAllTeams")}</Label>
            <div className="relative mt-1.5">
              <SearchIcon
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                id="queue-operator-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("queueSearchAllTeamsPlaceholder")}
                className="pl-8"
              />
            </div>
          </div>
        </div>
      </Surface>

      <h2 className="type-section-title">{t("queueActiveRooms")}</h2>

      {visibleRooms.length === 0 ? (
        <Surface padding="spacious" className="text-center">
          <p className="text-sm font-medium">{t("queueNoMatchingTeams")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("queueNoMatchingTeamsDescription")}
          </p>
        </Surface>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {visibleRooms.map((room) => (
            <RoomOperatorCard
              key={room.room.id}
              room={room}
              matchingEntryIds={matchingEntryIds}
              acknowledgedIds={acknowledgedIds}
              canOperate={canOperate}
              busy={busy}
              onAction={runAction}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoomOperatorCard({
  room,
  matchingEntryIds,
  acknowledgedIds,
  canOperate,
  busy,
  onAction,
  t,
}: {
  room: RoomView;
  matchingEntryIds: Set<number>;
  acknowledgedIds: Set<number>;
  canOperate: boolean;
  busy: string | null;
  onAction: (entry: QueueEntry, action: OperatorAction, roomId?: number) => Promise<void>;
  t: Translate;
}) {
  const called = room.called.filter((entry) => matchingEntryIds.has(entry.id));
  const next = room.next.find((entry) => matchingEntryIds.has(entry.id));
  const queueName = textForDisplay(room.challenge?.title ?? "") || t("challengeFallback");

  return (
    <SectionCard
      title={room.room.name}
      icon={DoorOpenIcon}
      action={<span className="text-muted-foreground text-sm font-medium">{queueName}</span>}
      bodyClassName="p-0"
    >
      <div className="border-b px-4 py-3.5 sm:px-5">
        <h3 className="mb-3 text-sm font-semibold">{t("queueWaitingRoomTeams")}</h3>
        {called.length > 0 ? (
          <div className="space-y-2">
            {called.map((entry, index) => (
              <CalledTeamRow
                key={entry.id}
                entry={entry}
                number={index + 1}
                room={room}
                acknowledged={acknowledgedIds.has(entry.id)}
                canOperate={canOperate}
                busy={busy}
                onAction={onAction}
                t={t}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-control bg-muted/40 px-3 py-3 text-sm">
            {t("queueNoWaitingRoomTeams")}
          </p>
        )}
      </div>

      <div className="px-4 py-3.5 sm:px-5">
        <h3 className="mb-3 text-sm font-semibold">{t("queueNextTeams")}</h3>
        {next ? (
          <div className="rounded-control border">
            <WaitingTeamRow
              entry={next}
              room={room}
              canOperate={canOperate}
              busy={busy}
              onAction={onAction}
              t={t}
            />
          </div>
        ) : (
          <p className="text-muted-foreground rounded-control border px-3 py-3 text-sm">
            {t("noWaitingTeam")}
          </p>
        )}
      </div>
    </SectionCard>
  );
}

function CalledTeamRow({
  entry,
  number,
  room,
  acknowledged,
  canOperate,
  busy,
  onAction,
  t,
}: {
  entry: QueueEntry;
  number: number;
  room: RoomView;
  acknowledged: boolean;
  canOperate: boolean;
  busy: string | null;
  onAction: (entry: QueueEntry, action: OperatorAction, roomId?: number) => Promise<void>;
  t: Translate;
}) {
  const name = entry.repo_name ?? t("repoNumber", { id: entry.repo_id });
  const busyAction = (action: OperatorAction) => busy === `${action}-${entry.id}`;
  return (
    <div className="rounded-control border bg-background px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-muted-foreground w-5 shrink-0 text-right text-sm tabular-nums">
            {number}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-medium">{name}</p>
              {acknowledged ? (
                <span className="text-success flex items-center gap-1 text-xs font-medium">
                  <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
                  {t("queueArrivalConfirmed")}
                </span>
              ) : (
                <span className="text-warning-foreground text-xs font-medium">
                  {t("queueArrivalUnconfirmed")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {!acknowledged && (
            <Button
              size="xs"
              disabled={!canOperate || busyAction("acknowledge")}
              onClick={() => void onAction(entry, "acknowledge")}
            >
              <CheckCircle2Icon className="size-3.5" />
              {t("queueConfirmArrival")}
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            disabled={!canOperate || busyAction("notify-enter")}
            onClick={() => void onAction(entry, "notify-enter")}
          >
            <DoorOpenIcon className="size-3.5" />
            {t("queueNotifyEntrance")}
          </Button>
          <QueueEntryMenu
            entry={entry}
            roomId={room.room.id}
            canOperate={canOperate}
            busy={busy}
            onAction={onAction}
            t={t}
            includeManualCall={false}
          />
        </div>
      </div>
    </div>
  );
}

function WaitingTeamRow({
  entry,
  room,
  canOperate,
  busy,
  onAction,
  t,
}: {
  entry: QueueEntry;
  room: RoomView;
  canOperate: boolean;
  busy: string | null;
  onAction: (entry: QueueEntry, action: OperatorAction, roomId?: number) => Promise<void>;
  t: Translate;
}) {
  const name = entry.repo_name ?? t("repoNumber", { id: entry.repo_id });
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="truncate text-sm">{name}</span>
      <QueueEntryMenu
        entry={entry}
        roomId={room.room.id}
        canOperate={canOperate}
        busy={busy}
        onAction={onAction}
        t={t}
        includeManualCall
      />
    </div>
  );
}

function QueueEntryMenu({
  entry,
  roomId,
  canOperate,
  busy,
  onAction,
  t,
  includeManualCall,
}: {
  entry: QueueEntry;
  roomId: number;
  canOperate: boolean;
  busy: string | null;
  onAction: (entry: QueueEntry, action: OperatorAction, roomId?: number) => Promise<void>;
  t: Translate;
  includeManualCall: boolean;
}) {
  const disabled = !canOperate || Boolean(busy?.endsWith(`-${entry.id}`));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-xs" disabled={disabled} aria-label={t("moreActions")}>
          <EllipsisIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {includeManualCall && (
          <DropdownMenuItem onSelect={() => void onAction(entry, "manual-call", roomId)}>
            <UsersIcon className="size-4" />
            {t("queueManualAdd")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void onAction(entry, "top")}>
          <ListEndIcon className="size-4 rotate-180" />
          {t("queuePrioritize")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void onAction(entry, "requeue")}>
          <ListEndIcon className="size-4" />
          {t("queueMoveToEnd")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => void onAction(entry, "absent")}>
          {t("absent")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
