import { describe, expect, it } from "vitest";
import { membershipBusyState } from "./queue";

describe("membershipBusyState (#931, H30)", () => {
  it("allows every action when no member is occupied elsewhere", () => {
    expect(membershipBusyState({ busy_status: null })).toEqual({
      blocksCall: false,
      blocksMove: false,
      evaluating: false,
    });
  });

  it("blocks only calls while a member waits at another room's door", () => {
    expect(membershipBusyState({ busy_status: "called" })).toEqual({
      blocksCall: true,
      blocksMove: false,
      evaluating: false,
    });
  });

  it.each(["in_room", "presenting"] as const)("blocks calls and moves while %s", (status) => {
    expect(membershipBusyState({ busy_status: status })).toEqual({
      blocksCall: true,
      blocksMove: true,
      evaluating: true,
    });
  });
});
