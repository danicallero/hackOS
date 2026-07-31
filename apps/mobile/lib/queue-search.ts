/**
 * H29-H31 queue operations search: one result per queue entry, not per room.
 *
 * `roomView` builds its `next` list from the challenge queue, so every room
 * that judges a challenge returns the SAME waiting entries. Searching across
 * rooms therefore has to fold those repeats back into a single result that
 * lists every room the team can be judged in.
 */

export interface QueueMember {
  email: string;
  name: string | null;
  surname: string | null;
}

export interface QueueEntry {
  id: number;
  repo_name?: string;
  repo_members?: QueueMember[];
  position: number | null;
  status: string;
}

export interface QueueRoom {
  id: number;
  name: string;
  location: string | null;
}

export interface RoomView {
  room: QueueRoom;
  state: { is_paused: boolean } | null;
  challenge: { id: number; title: string; enterprise_name: string } | null;
  active: QueueEntry | null;
  called: QueueEntry[];
  next: QueueEntry[];
}

export interface QueueSearchResult {
  entry: QueueEntry;
  /** Every room this entry can be judged in, ordered by room name. */
  rooms: QueueRoom[];
  challengeTitle: string | null;
}

/** Every matching entry across every room, folded to one result per entry. */
export function findQueueEntries(rooms: RoomView[], query: string): QueueSearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const byEntryId = new Map<number, QueueSearchResult>();
  for (const view of rooms) {
    for (const entry of [view.active, ...view.called, ...view.next]) {
      if (entry === null) continue;
      if (!queueEntrySearchText(entry).includes(normalizedQuery)) continue;
      const existing = byEntryId.get(entry.id);
      if (existing) {
        if (!existing.rooms.some((room) => room.id === view.room.id)) {
          existing.rooms.push(view.room);
        }
        existing.challengeTitle ??= view.challenge?.title ?? null;
        continue;
      }
      byEntryId.set(entry.id, {
        entry,
        rooms: [view.room],
        challengeTitle: view.challenge?.title ?? null,
      });
    }
  }

  for (const result of byEntryId.values()) {
    result.rooms.sort((a, b) => a.name.localeCompare(b.name));
  }

  return [...byEntryId.values()].sort(
    (a, b) =>
      (a.entry.repo_name ?? "").localeCompare(b.entry.repo_name ?? "") ||
      (a.challengeTitle ?? "").localeCompare(b.challengeTitle ?? ""),
  );
}

function queueEntrySearchText(entry: QueueEntry): string {
  return [
    entry.repo_name,
    ...(entry.repo_members ?? []).flatMap((member) => [member.name, member.surname, member.email]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase();
}
