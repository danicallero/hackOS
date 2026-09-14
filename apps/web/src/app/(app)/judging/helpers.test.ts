import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { queueErrorToastContent, secondsLabel } from "./helpers";

describe("judging helpers", () => {
  it("formats the presentation clock, including past the limit", () => {
    expect(secondsLabel(0)).toBe("00:00");
    expect(secondsLabel(65)).toBe("01:05");
    expect(secondsLabel(600)).toBe("10:00");
    expect(secondsLabel(3600)).toBe("60:00"); // counts in minutes, never rolls to hours

    // Over time is shown as a negative remaining, so the sign sits outside the
    // padding rather than eating a digit ("-01:05", not "0-1:05").
    expect(secondsLabel(-65)).toBe("-01:05");
    expect(secondsLabel(-5)).toBe("-00:05");

    // Fractional seconds truncate toward zero rather than rendering "01:05.4".
    expect(secondsLabel(65.9)).toBe("01:05");

    expect(secondsLabel(null)).toBe("—");
    expect(secondsLabel(undefined)).toBe("—");
  });

  it("moves H30 details into an automatically expanded toast description", () => {
    expect(
      queueErrorToastContent(
        new ApiError(409, "conflict", "Team has a member busy in another room (H30)"),
        "Queue action failed.",
        "Couldn't call team",
        "This team cannot be called yet because one of its members is active in another room.",
      ),
    ).toEqual({
      message: "Team has a member busy in another room (H30)",
      title: "Couldn't call team",
      description:
        "This team cannot be called yet because one of its members is active in another room.",
      isBusyTeam: true,
    });
  });

  it("keeps useful non-H30 API errors as expandable details", () => {
    expect(
      queueErrorToastContent(
        new ApiError(409, "conflict", "Room already has an active team"),
        "Queue action failed.",
        "Couldn't call team",
        "This team cannot be called yet because one of its members is active in another room.",
      ),
    ).toMatchObject({
      title: "Queue action failed.",
      description: "Room already has an active team",
      isBusyTeam: false,
    });
  });
});
