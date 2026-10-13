import { describe, expect, it } from "vitest";
import type { RoomView } from "@/lib/queue";
import { operatorRows, operatorRowsForRooms, sortOperatorRows } from "./operator-console-model";

function room(id: number, overrides: Partial<RoomView> = {}): RoomView {
  return {
    room: { id, name: `Room ${id}`, location: null } as RoomView["room"],
    state: { is_paused: false } as RoomView["state"],
    challenge: { id, title: `Challenge ${id}`, enterprise_name: "Sponsor", queue_group_id: id },
    active: null,
    called: [],
    next: [],
    crossRoomSkips: [],
    ...overrides,
  };
}

function entry(
  id: number,
  status: string,
  position: number | null = null,
  calledAt: string | null = null,
) {
  return {
    id,
    challenge_id: 1,
    repo_id: id,
    assigned_room_id: null,
    status,
    position,
    priority: 0,
    call_count: 0,
    called_at: calledAt,
    presentation_started_at: null,
    completed_at: null,
    precalled_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    repo_name: `Team ${id}`,
  } as RoomView["next"][number];
}

describe("queue operator console model", () => {
  it("keeps the attention view focused on called teams and the next waiting team", () => {
    const view = room(1, {
      called: [entry(20, "called")],
      next: [entry(21, "waiting", 1), entry(22, "waiting", 2)],
    });

    expect(operatorRows(view, "attention").map((row) => [row.entry.id, row.kind])).toEqual([
      [20, "called"],
      [21, "waiting"],
    ]);
    expect(operatorRows(view, "waiting").map((row) => row.entry.id)).toEqual([21, 22]);
  });

  it("orders called teams before waiting teams and live work", () => {
    const view = room(1, {
      active: entry(30, "presenting"),
      called: [entry(31, "called")],
      next: [entry(32, "waiting", 1)],
    });

    expect(sortOperatorRows(operatorRows(view, "all")).map((row) => row.entry.id)).toEqual([
      31, 32, 30,
    ]);
  });

  it("orders called teams by call time, not position (which is null once called)", () => {
    const view = room(1, {
      called: [
        entry(50, "called", null, "2026-01-01T00:02:00.000Z"),
        entry(51, "called", null, "2026-01-01T00:01:00.000Z"),
      ],
    });

    expect(sortOperatorRows(operatorRows(view, "all")).map((row) => row.entry.id)).toEqual([
      51, 50,
    ]);
  });

  it("deduplicates waiting teams across rooms serving one shared queue", () => {
    const sharedRoom = room(2, {
      challenge: { id: 2, title: "Challenge 2", enterprise_name: "Sponsor", queue_group_id: 9 },
      next: [entry(41, "waiting", 2)],
    });
    const firstRoom = room(1, {
      challenge: { id: 1, title: "Challenge 1", enterprise_name: "Sponsor", queue_group_id: 9 },
      next: [entry(40, "waiting", 1), entry(41, "waiting", 2)],
    });

    const rows = operatorRowsForRooms([firstRoom, sharedRoom], "waiting");
    expect(rows.map((row) => row.entry.id)).toEqual([40, 41]);
    expect(rows[0]?.destinationRooms?.map((item) => item.room.id)).toEqual([1, 2]);
  });
});
