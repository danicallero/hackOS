"use client";

import { BellRingIcon, DoorOpenIcon, EllipsisIcon, ListEndIcon, UsersIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Surface } from "@/components/ui/surface";
import { ApiError } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { entryAction, moveQueueEntryToPosition, type QueueEntry, type RoomView } from "@/lib/queue";
import { textForDisplay } from "../challenges/shared";
import { operatorRowsForRooms, sortOperatorRows } from "./operator-console-model";

type OperatorAction =
  | "notify-enter"
  | "remind-waiting"
  | "manual-call"
  | "requeue"
  | "absent"
  | "top";

/**
 * The operator's default view is room-first. Normal communication stays
 * visible on the team row; exceptional queue changes stay in the overflow
 * menu so the room board remains easy to scan.
 */
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
  const [busy, setBusy] = useState<string | null>(null);
  const activeRooms = useMemo(() => rooms.filter((room) => !room.state?.is_paused), [rooms]);
  const allRows = useMemo(
    () => sortOperatorRows(operatorRowsForRooms(activeRooms, "all")),
    [activeRooms],
  );
  const matchingEntryIds = useMemo(() => new Set(allRows.map((row) => row.entry.id)), [allRows]);
  const runAction = async (
    entry: QueueEntry,
    action: OperatorAction,
    roomId?: number,
  ): Promise<void> => {
    const key = `${action}-${entry.id}`;
    setBusy(key);
    try {
      if (action === "notify-enter") {
        await entryAction(entry.id, "notify-enter", undefined, crypto.randomUUID());
        toast.success(t("entranceNoticeSent"));
      } else if (action === "remind-waiting") {
        await entryAction(entry.id, "remind-waiting", undefined, crypto.randomUUID());
        toast.success(t("queueWaitingRoomReminderSent"));
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
      toast.error(err instanceof ApiError ? err.message : t("queueActionFailed"));
    } finally {
      setBusy(null);
    }
  };

  const visibleRooms = activeRooms;

  return (
    <div className="space-y-5">
      {visibleRooms.length === 0 ? (
        <Surface padding="spacious" className="text-center">
          <p className="text-sm font-medium">{t("queueNoMatchingTeams")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("queueNoMatchingTeamsDescription")}
          </p>
        </Surface>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {visibleRooms.map((room) => (
            <RoomOperatorCard
              key={room.room.id}
              room={room}
              matchingEntryIds={matchingEntryIds}
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
  canOperate,
  busy,
  onAction,
  t,
}: {
  room: RoomView;
  matchingEntryIds: Set<number>;
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
  canOperate,
  busy,
  onAction,
  t,
}: {
  entry: QueueEntry;
  number: number;
  room: RoomView;
  canOperate: boolean;
  busy: string | null;
  onAction: (entry: QueueEntry, action: OperatorAction, roomId?: number) => Promise<void>;
  t: Translate;
}) {
  const name = entry.repo_name ?? t("repoNumber", { id: entry.repo_id });
  const busyAction = (action: OperatorAction) => busy === `${action}-${entry.id}`;
  return (
    <div className="relative rounded-control border bg-background px-3 py-3">
      <div className="flex min-w-0 items-start gap-3 pr-8">
        <span className="text-muted-foreground w-5 shrink-0 pt-0.5 text-right text-sm tabular-nums">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="min-w-0 truncate text-sm font-medium" title={name}>
            {name}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              disabled={!canOperate || busyAction("remind-waiting")}
              onClick={() => void onAction(entry, "remind-waiting")}
            >
              <BellRingIcon className="size-3.5" />
              {t("queueRemindWaiting")}
            </Button>
          </div>
        </div>
      </div>
      <div className="absolute top-3 right-3">
        <QueueEntryMenu
          entry={entry}
          roomId={room.room.id}
          canOperate={canOperate}
          busy={busy}
          onAction={onAction}
          t={t}
          includeManualCall={false}
          includeNotify
        />
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
    <div className="relative px-3 py-2.5">
      <p className="min-w-0 truncate pr-8 text-sm" title={name}>
        {name}
      </p>
      <div className="absolute top-2.5 right-3">
        <QueueEntryMenu
          entry={entry}
          roomId={room.room.id}
          canOperate={canOperate}
          busy={busy}
          onAction={onAction}
          t={t}
          includeManualCall
          includeNotify={false}
        />
      </div>
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
  includeNotify,
}: {
  entry: QueueEntry;
  roomId: number;
  canOperate: boolean;
  busy: string | null;
  onAction: (entry: QueueEntry, action: OperatorAction, roomId?: number) => Promise<void>;
  t: Translate;
  includeManualCall: boolean;
  includeNotify: boolean;
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
        {includeNotify && (
          <DropdownMenuItem onSelect={() => void onAction(entry, "notify-enter")}>
            <DoorOpenIcon className="size-4" />
            {t("queueNotifyEntrance")}
          </DropdownMenuItem>
        )}
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
