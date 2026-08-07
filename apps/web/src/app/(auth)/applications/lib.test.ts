import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { isConfirmExpiredError, isDeclineExpiredError } from "./lib";

describe("confirm/decline token-action expiry detection", () => {
  it("recognizes the confirm endpoint's confirmation_expired code", () => {
    const err = new ApiError(409, "conflict", "expired", { code: "confirmation_expired" });
    expect(isConfirmExpiredError(err)).toBe(true);
  });

  it("recognizes the confirm endpoint's expired flag", () => {
    const err = new ApiError(409, "conflict", "expired", { expired: true });
    expect(isConfirmExpiredError(err)).toBe(true);
  });

  it("does not treat an unrelated error as expired", () => {
    const err = new ApiError(404, "not_found", "not found");
    expect(isConfirmExpiredError(err)).toBe(false);
    expect(isDeclineExpiredError(err)).toBe(false);
  });

  it("recognizes the decline endpoint's expired status", () => {
    const err = new ApiError(409, "conflict", "expired", { status: "expired" });
    expect(isDeclineExpiredError(err)).toBe(true);
  });

  it("ignores non-ApiError values", () => {
    expect(isConfirmExpiredError(new Error("boom"))).toBe(false);
    expect(isDeclineExpiredError("nope")).toBe(false);
  });
});
