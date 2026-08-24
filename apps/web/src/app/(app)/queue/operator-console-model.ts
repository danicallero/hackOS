import type { QueueEntry, RoomView } from "@/lib/queue";

export type OperatorQueueFilter = "all" | "attention" | "waiting" | "called" | "live";

export type OperatorEntryKind = "active" | "called" | "waiting";

export interface OperatorQueueStats {
  activeRooms: number;
  pausedRooms: number;
  presenting: number;
  called: number;
  waiting: number;
}

export interface OperatorEntryRow {
  entry: QueueEntry;
  kind: OperatorEntryKind;
  room: RoomView;
  /** Waiting teams may be called into any room serving this queue group. */
  destinationRooms?: RoomView[];
}

function queueKey(room: RoomView): string {
  const challenge = room.challenge as (RoomView["challenge"] & { queue_group_id?: number }) | null;
  return `queue:${challenge?.queue_group_id ?? challenge?.id ?? room.room.id}`;
}

/**
 * The operator's first question is operational, not analytical: how many
 * teams need a hand and which rooms are currently moving? Keep this derived
 * model independent from rendering so the board and its tests share one
 * definition of the counters (H29-H35, H41).
 */
export function operatorQueueStats(rooms: RoomView[]): OperatorQueueStats {
  const waiting = new Set<string>();
  const stats = { activeRooms: 0, pausedRooms: 0, presenting: 0, called: 0, waiting: 0 };
  for (const room of rooms) {
    stats.activeRooms += room.state?.is_paused ? 0 : 1;
    stats.pausedRooms += room.state?.is_paused ? 1 : 0;
    stats.presenting += room.active ? 1 : 0;
    stats.called += room.called.length;
    for (const entry of room.next) waiting.add(`${queueKey(room)}:${entry.repo_id}`);
  }
  stats.waiting = waiting.size;
  return stats;
}

export function roomNeedsAttention(room: RoomView): boolean {
  return room.called.length > 0 || room.next.length > 0;
}

/**
 * Build the rows that matter for a queue operator. "Attention" deliberately
 * shows every called team plus only the next waiting team per room; the
 * waiting filter exposes the full queue without making the default board
 * noisy when a challenge has many entries (H29-H34).
 */
export function operatorRows(room: RoomView, filter: OperatorQueueFilter): OperatorEntryRow[] {
  const rows: OperatorEntryRow[] = [];
  if ((filter === "all" || filter === "live") && room.active) {
    rows.push({ entry: room.active, kind: "active", room });
  }
  if (filter === "all" || filter === "attention" || filter === "called") {
    rows.push(...room.called.map((entry) => ({ entry, kind: "called" as const, room })));
  }
  if (filter === "all" || filter === "waiting") {
    rows.push(...room.next.map((entry) => ({ entry, kind: "waiting" as const, room })));
  }
  if (filter === "attention") {
    const firstWaiting = room.next[0];
    if (firstWaiting) rows.push({ entry: firstWaiting, kind: "waiting", room });
  }
  return rows;
}

/**
 * Merge room projections into the operator's single arrival lane. A shared
 * queue appears once even when three rooms serve it; called and active entries
 * remain attached to their concrete room (H29/H30/H41/H46).
 */
export function operatorRowsForRooms(
  rooms: RoomView[],
  filter: OperatorQueueFilter,
): OperatorEntryRow[] {
  const destinationByQueue = new Map<string, RoomView[]>();
  for (const room of rooms) {
    const key = queueKey(room);
    destinationByQueue.set(key, [...(destinationByQueue.get(key) ?? []), room]);
  }

  const seenWaiting = new Set<string>();
  return rooms.flatMap((room) =>
    operatorRows(room, filter).filter((row) => {
      if (row.kind !== "waiting") return true;
      const key = `${queueKey(room)}:${row.entry.repo_id}`;
      if (seenWaiting.has(key)) return false;
      seenWaiting.add(key);
      row.destinationRooms = destinationByQueue.get(queueKey(room));
      return true;
    }),
  );
}

export function filterOperatorRows(rows: OperatorEntryRow[], query: string): OperatorEntryRow[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    const rooms = row.destinationRooms ?? [row.room];
    const challengeNames = rooms.map((item) => item.challenge?.title ?? "");
    return [
      row.entry.repo_name ?? "",
      String(row.entry.repo_id),
      String(row.entry.id),
      ...rooms.map((item) => item.room.name),
      ...challengeNames,
    ].some((value) => value.toLocaleLowerCase().includes(needle));
  });
}

export function sortOperatorRows(rows: OperatorEntryRow[]): OperatorEntryRow[] {
  const kindOrder: Record<OperatorEntryKind, number> = { called: 0, waiting: 1, active: 2 };
  return [...rows].sort((a, b) => {
    const kindDifference = kindOrder[a.kind] - kindOrder[b.kind];
    if (kindDifference !== 0) return kindDifference;
    const positionA = a.entry.position ?? Number.MAX_SAFE_INTEGER;
    const positionB = b.entry.position ?? Number.MAX_SAFE_INTEGER;
    return positionA - positionB || a.entry.id - b.entry.id;
  });
}
