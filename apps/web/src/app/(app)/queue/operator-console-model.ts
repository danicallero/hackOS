import type { QueueEntry, RoomView } from "@/lib/queue";

export type OperatorQueueFilter = "all" | "attention" | "waiting" | "called" | "live";

export type OperatorEntryKind = "active" | "called" | "waiting";

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

export function sortOperatorRows(rows: OperatorEntryRow[]): OperatorEntryRow[] {
  const kindOrder: Record<OperatorEntryKind, number> = { called: 0, waiting: 1, active: 2 };
  return [...rows].sort((a, b) => {
    const kindDifference = kindOrder[a.kind] - kindOrder[b.kind];
    if (kindDifference !== 0) return kindDifference;
    // A called entry has no waiting-line position anymore (it already
    // entered the waiting room), so every called row now ties on position —
    // order the called bucket by call time instead, matching roomView.called
    // (reads.ts: `ORDER BY called_at ASC`).
    if (a.kind === "called") {
      const calledAtA = a.entry.called_at ? Date.parse(a.entry.called_at) : Number.MAX_SAFE_INTEGER;
      const calledAtB = b.entry.called_at ? Date.parse(b.entry.called_at) : Number.MAX_SAFE_INTEGER;
      return calledAtA - calledAtB || a.entry.id - b.entry.id;
    }
    const positionA = a.entry.position ?? Number.MAX_SAFE_INTEGER;
    const positionB = b.entry.position ?? Number.MAX_SAFE_INTEGER;
    return positionA - positionB || a.entry.id - b.entry.id;
  });
}
