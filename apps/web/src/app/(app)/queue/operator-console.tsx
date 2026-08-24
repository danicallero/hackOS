"use client";

import {
  BellRingIcon,
  DoorOpenIcon,
  ListFilterIcon,
  MapPinIcon,
  MoreHorizontalIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Surface } from "@/components/ui/surface";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { entryAction, type QueueEntry, type RoomView } from "@/lib/queue";
import { textForDisplay } from "../challenges/shared";
import {
  filterOperatorRows,
  type OperatorEntryRow,
  type OperatorQueueFilter,
  operatorQueueStats,
  operatorRowsForRooms,
  sortOperatorRows,
} from "./operator-console-model";

const FILTERS: OperatorQueueFilter[] = ["attention", "all", "waiting", "called", "live"];

function filterLabel(t: Translate, filter: OperatorQueueFilter): string {
  switch (filter) {
    case "attention":
      return t("queueFilterAttention");
    case "all":
      return t("queueFilterAll");
    case "waiting":
      return t("queueFilterWaiting");
    case "called":
      return t("queueFilterCalled");
    case "live":
      return t("queueFilterLive");
  }
}

export function QueueOperatorConsole({
  rooms,
  canOperate,
  onChanged,
}: {
  rooms: RoomView[];
  canOperate: boolean;
  onChanged: () => void;
}) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<OperatorQueueFilter>("attention");
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const stats = useMemo(() => operatorQueueStats(rooms), [rooms]);
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );
  const visibleRooms = useMemo(
    () => (selectedRoom ? [selectedRoom] : rooms),
    [rooms, selectedRoom],
  );
  const rows = useMemo(
    () => filterOperatorRows(sortOperatorRows(operatorRowsForRooms(visibleRooms, filter)), query),
    [filter, query, visibleRooms],
  );

  const runAction = async (
    entry: QueueEntry,
    action: "notify" | "waiting" | "requeue" | "absent" | "top",
    roomId?: number,
  ) => {
    const key = `${action}-${entry.id}`;
    setBusy(key);
    try {
      if (action === "notify") {
        await entryAction(entry.id, "notify-enter", undefined, crypto.randomUUID());
        toast.success(t("teamRenotified"));
      } else if (action === "waiting") {
        if (!roomId) return;
        await entryAction(
          entry.id,
          "manual-call",
          {
            targetStatus: "called",
            roomId,
            reason: "Queue operations: sent to waiting room",
          },
          crypto.randomUUID(),
        );
        toast.success(t("teamAddedWaiting"));
      } else if (action === "requeue") {
        await entryAction(
          entry.id,
          "requeue",
          { position: "bottom", reason: "Queue operations: requeued" },
          crypto.randomUUID(),
        );
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
          { reason: "Queue operations: moved to top" },
          crypto.randomUUID(),
        );
        toast.success(t("teamMovedTop"));
      }
      setQuery("");
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("queueActionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const title = query.trim()
    ? t("queueSearchResults")
    : filter === "attention"
      ? t("queueNeedsAction")
      : filterLabel(t, filter);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label={t("queueCalledNow")} value={stats.called} icon={BellRingIcon} />
        <StatCard label={t("queueWaitingTeams")} value={stats.waiting} icon={UsersIcon} />
        <StatCard label={t("queueInRooms")} value={stats.presenting} icon={DoorOpenIcon} />
        <StatCard label={t("queueLiveRooms")} value={stats.activeRooms} icon={MapPinIcon} />
        <StatCard label={t("queuePausedRooms")} value={stats.pausedRooms} icon={ListFilterIcon} />
      </div>

      <Surface padding="compact" className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="type-section-title">{t("queueOperatorBoard")}</h2>
              <StatusBadge tone="success">{t("queueLiveUpdates")}</StatusBadge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("queueOperatorBoardDescription")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="queue-operator-filter">{t("queueFilterLabel")}</Label>
              <Select
                value={filter}
                onValueChange={(value) => setFilter(value as OperatorQueueFilter)}
              >
                <SelectTrigger id="queue-operator-filter" className="w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {filterLabel(t, value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:min-w-64">
              <Label htmlFor="queue-operator-search">{t("queueSearchAllTeams")}</Label>
              <div className="relative">
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
        </div>
        {selectedRoom && (
          <div className="flex items-center justify-between gap-3 border-t pt-3 text-sm">
            <span className="text-muted-foreground">
              {t("queueFilteredRoom")}:{" "}
              <span className="text-foreground font-medium">{selectedRoom.room.name}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setSelectedRoomId(null)}>
              {t("queueViewAllRooms")}
            </Button>
          </div>
        )}
      </Surface>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <SectionCard
          title={title}
          state={
            <StatusBadge tone={rows.length > 0 ? "warning" : "neutral"}>{rows.length}</StatusBadge>
          }
          bodyClassName="p-0"
        >
          {rows.length > 0 ? (
            <div className="divide-y">
              {rows.map((row) => (
                <OperatorEntryRowView
                  key={`${row.room.room.id}-${row.entry.id}-${row.kind}`}
                  row={row}
                  canOperate={canOperate}
                  busy={busy}
                  onAction={runAction}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium">{t("queueNoMatchingTeams")}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("queueNoMatchingTeamsDescription")}
              </p>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={t("queueRoomDestinations")}
          state={<StatusBadge tone="neutral">{rooms.length}</StatusBadge>}
          bodyClassName="p-0"
        >
          {rooms.length === 0 ? (
            <p className="text-muted-foreground px-5 py-8 text-sm">{t("noRoomsYet")}</p>
          ) : (
            <ul className="divide-y" aria-label={t("queueRoomDestinations")}>
              <li>
                <button
                  type="button"
                  className={`flex w-full items-start justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedRoomId === null ? "bg-accent/60" : ""}`}
                  aria-pressed={selectedRoomId === null}
                  onClick={() => setSelectedRoomId(null)}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t("queueViewAllRooms")}</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {t("queueAllRoomDestinations")}
                    </span>
                  </span>
                  <StatusBadge tone="neutral">{rooms.length}</StatusBadge>
                </button>
              </li>
              {rooms.map((room) => (
                <li key={room.room.id}>
                  <RoomDestination
                    room={room}
                    selected={selectedRoomId === room.room.id}
                    onSelect={() => setSelectedRoomId(room.room.id)}
                    t={t}
                  />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function OperatorEntryRowView({
  row,
  canOperate,
  busy,
  onAction,
  t,
}: {
  row: OperatorEntryRow;
  canOperate: boolean;
  busy: string | null;
  onAction: (
    entry: QueueEntry,
    action: "notify" | "waiting" | "requeue" | "absent" | "top",
    roomId?: number,
  ) => Promise<void>;
  t: Translate;
}) {
  const entryName = row.entry.repo_name ?? t("repoNumber", { id: row.entry.repo_id });
  const queueName = textForDisplay(row.room.challenge?.title ?? "") || t("challengeFallback");
  const destinationRooms = row.destinationRooms ?? [row.room];
  const destinationNames = destinationRooms.map((item) => item.room.name).join(", ");
  const isBusy = (action: string) => busy === `${action}-${row.entry.id}`;

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="bg-muted text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-full">
          {row.kind === "active" ? (
            <DoorOpenIcon className="size-4" />
          ) : (
            <UsersIcon className="size-4" />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{entryName}</p>
            <QueueStatusBadge status={row.entry.status} />
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>
              {row.kind === "waiting"
                ? t("queueDestinationRooms", { rooms: destinationNames })
                : row.room.room.name}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{queueName}</span>
            {row.entry.position != null && (
              <span>{t("queuePosition", { position: row.entry.position })}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
        {row.kind === "active" ? (
          <span className="text-muted-foreground text-xs">{t("presentationInProgress")}</span>
        ) : row.kind === "called" ? (
          <>
            <Button
              size="sm"
              disabled={!canOperate || isBusy("notify")}
              onClick={() => void onAction(row.entry, "notify")}
            >
              <BellRingIcon className="size-4" />
              {t("renotify")}
            </Button>
            <EntryOverflowMenu
              disabled={!canOperate || isBusy("requeue") || isBusy("absent")}
              onRequeue={() => void onAction(row.entry, "requeue")}
              onAbsent={() => void onAction(row.entry, "absent")}
              t={t}
            />
          </>
        ) : (
          <>
            <Button
              size="sm"
              disabled={!canOperate || !row.room.room.id || isBusy("waiting")}
              onClick={() => void onAction(row.entry, "waiting", row.room.room.id)}
            >
              <DoorOpenIcon className="size-4" />
              {t("queueSendToWaiting")}
            </Button>
            <EntryOverflowMenu
              disabled={!canOperate || isBusy("top")}
              onTop={() => void onAction(row.entry, "top")}
              t={t}
            />
          </>
        )}
      </div>
    </div>
  );
}

function EntryOverflowMenu({
  disabled,
  onRequeue,
  onAbsent,
  onTop,
  t,
}: {
  disabled: boolean;
  onRequeue?: () => void;
  onAbsent?: () => void;
  onTop?: () => void;
  t: Translate;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" disabled={disabled} aria-label={t("moreActions")}>
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onTop && <DropdownMenuItem onSelect={onTop}>{t("top")}</DropdownMenuItem>}
        {onRequeue && <DropdownMenuItem onSelect={onRequeue}>{t("requeue")}</DropdownMenuItem>}
        {onAbsent && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onAbsent}>
              {t("absent")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RoomDestination({
  room,
  selected,
  onSelect,
  t,
}: {
  room: RoomView;
  selected: boolean;
  onSelect: () => void;
  t: Translate;
}) {
  const activeTeam = room.active?.repo_name ?? null;
  const nextTeam = room.next[0]?.repo_name ?? null;
  return (
    <button
      type="button"
      className={`flex w-full items-start justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "bg-accent/60" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="min-w-0 space-y-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{room.room.name}</span>
          <StatusBadge tone={room.state?.is_paused ? "warning" : "success"}>
            {room.state?.is_paused ? t("paused") : t("live")}
          </StatusBadge>
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {room.room.location ?? t("noLocation")}
        </span>
        <span className="block text-xs">
          {activeTeam ? `${t("presenting")}: ${activeTeam}` : t("noTeamPresenting")}
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {nextTeam ? `${t("nextAtTop")}: ${nextTeam}` : t("noWaitingTeam")}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-xs tabular-nums">
        {room.called.length > 0 && <StatusBadge tone="warning">{room.called.length}</StatusBadge>}
        <span className="text-muted-foreground">
          {t("queueWaitingCount", { count: room.next.length })}
        </span>
      </span>
    </button>
  );
}
