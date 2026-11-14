import { describe, expect, it } from "vitest";
import type { Room } from "@/lib/queue";
import { filterRoomsBySearch } from "./room-management";

const rooms: Room[] = [
  {
    id: 1,
    name: "Sala José",
    location: "A Coruña",
    status: "active",
    enterprise_name: "Núñez Labs",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Other",
    location: null,
    status: "paused",
    enterprise_name: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("room search", () => {
  it("matches room text without case or accent sensitivity and preserves status filtering", () => {
    expect(filterRoomsBySearch(rooms, "JOSE", "all").map((room) => room.id)).toEqual([1]);
    expect(filterRoomsBySearch(rooms, "coruna", "active").map((room) => room.id)).toEqual([1]);
    expect(filterRoomsBySearch(rooms, "coruna", "paused")).toEqual([]);
  });
});
