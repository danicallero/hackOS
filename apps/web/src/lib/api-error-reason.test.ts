import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { apiErrorReason } from "./api-error-reason";

describe("apiErrorReason", () => {
  it("prefers the domain reason in details over the generic code", () => {
    const err = new ApiError(403, "forbidden", "Only sponsor representatives have a meal plan", {
      code: "not_sponsor",
    });
    expect(apiErrorReason(err)).toBe("not_sponsor");
  });

  it("falls back to the top-level code", () => {
    expect(apiErrorReason(new ApiError(409, "repeat_confirmation_required", "Confirm"))).toBe(
      "repeat_confirmation_required",
    );
    expect(apiErrorReason(new ApiError(400, "bad_request", "Bad", { code: 7 }))).toBe(
      "bad_request",
    );
  });

  it("has no reason for errors that did not come from the API", () => {
    expect(apiErrorReason(new Error("network"))).toBeNull();
  });
});
