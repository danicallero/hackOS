import { describe, expect, it } from "vitest";
import type { RoomAssignments } from "@/lib/queue";
import { classifyJudgingMode, roomsMissingJudges } from "./judging-mode";

function room(overrides: Partial<RoomAssignments> = {}): RoomAssignments {
  return {
    roomId: 1,
    room: {
      id: 1,
      name: "Room A",
      slug: "room-a",
      location: null,
      status: "active",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    challenges: [
      {
        challenge_id: 42,
        title: "Challenge",
        visibility: "hidden",
        assigned_at: "2026-01-01T00:00:00.000Z",
        assigned_by: null,
        assigned_by_name: null,
        assigned_by_surname: null,
        assigned_by_email: null,
      },
    ],
    judges: [],
    ...overrides,
  };
}

describe("classifyJudgingMode", () => {
  it("is external when no room is assigned (H46 opt-out of the queue)", () => {
    expect(classifyJudgingMode([])).toBe("external");
  });

  it("is queue-based once at least one room is assigned", () => {
    expect(classifyJudgingMode([room()])).toBe("queue");
  });
});

describe("roomsMissingJudges", () => {
  it("flags an assigned room with zero judges as an unresolved gap", () => {
    const gaps = roomsMissingJudges([room({ judges: [] })]);
    expect(gaps).toHaveLength(1);
  });

  it("does not flag a room once a judge is assigned", () => {
    const withJudge = room({
      judges: [
        {
          challenge_id: 42,
          enterprise_id: 3,
          title: "Challenge",
          user_id: 7,
          name: "Ada",
          surname: "Lovelace",
          email: "ada@example.com",
          assigned_at: "2026-01-01T00:00:00.000Z",
          assigned_by: null,
          assigned_by_name: null,
          assigned_by_surname: null,
          assigned_by_email: null,
        },
      ],
    });
    expect(roomsMissingJudges([withJudge])).toHaveLength(0);
  });

  it("is empty when the challenge runs external judging (no rooms to check)", () => {
    expect(roomsMissingJudges([])).toHaveLength(0);
  });
});
