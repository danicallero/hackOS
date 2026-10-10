import { describe, expect, it } from "vitest";
import { manualCallRoomIds, membershipBusyState } from "./queue";

describe("membershipBusyState (#931, H30)", () => {
  it("allows every action when no member is occupied elsewhere", () => {
    expect(membershipBusyState({ busy_status: null, busy_room_id: null })).toEqual({
      blocksCall: false,
      blocksMove: false,
      evaluating: false,
    });
  });

  it("blocks only calls while a member waits at another room's door", () => {
    expect(membershipBusyState({ busy_status: "called", busy_room_id: 7 })).toEqual({
      blocksCall: true,
      blocksMove: false,
      evaluating: false,
    });
  });

  it.each(["in_room", "presenting"] as const)("blocks calls and moves while %s", (status) => {
    expect(membershipBusyState({ busy_status: status, busy_room_id: 7 })).toEqual({
      blocksCall: true,
      blocksMove: true,
      evaluating: true,
    });
  });

  it("does not block a call into the room that already holds the occupancy", () => {
    const entry = { busy_status: "called", busy_room_id: 7 } as const;
    expect(membershipBusyState(entry, 7).blocksCall).toBe(false);
    expect(membershipBusyState(entry, 8).blocksCall).toBe(true);
  });
});

describe("manualCallRoomIds (#931, H30, H38)", () => {
  const rooms = [
    { id: 7, name: "Sala Mars" },
    { id: 8, name: "Sala Venus" },
  ];
  const waiting = {
    eligible: true,
    status: "waiting",
    judging_rooms: rooms,
    busy_status: null,
    busy_room_id: null,
  } as const;

  it("offers every judging room to an idle eligible team", () => {
    expect(manualCallRoomIds(waiting)).toEqual(new Set([7, 8]));
  });

  it("does not offer Manual add to an ineligible project", () => {
    expect(manualCallRoomIds({ ...waiting, eligible: false })).toBeNull();
  });

  it("keeps only the room that already holds a busy member", () => {
    expect(manualCallRoomIds({ ...waiting, busy_status: "called", busy_room_id: 7 })).toEqual(
      new Set([7]),
    );
  });
});
