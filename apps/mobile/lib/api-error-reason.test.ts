jest.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;
    constructor(message: string, status: number, code?: string, details?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import { SCAN_REPLAY_EXPIRED } from "@hackos/shared/idempotency";
import commonGl from "@hackos/shared/locales/gl/common.json";
import { ApiError } from "./api";
import { apiErrorText, scanFailureCode, scanFailureText } from "./api-error-reason";

const tGl = (key: string) => (commonGl as Record<string, string>)[key] ?? key;

describe("api error copy", () => {
  it("resolves a known reason to localized copy instead of the English message", () => {
    const err = new ApiError("English server text", 409, "conflict", {
      code: ERROR_REASONS.IDEMPOTENCY_IN_FLIGHT,
    });
    expect(apiErrorText(err, tGl as never, "fb")).toBe(commonGl.apiError_idempotency_in_flight);
  });

  it("falls back to status copy, then to the caller's copy", () => {
    expect(apiErrorText(new ApiError("x", 500), tGl as never, "fb")).toBe(commonGl.apiErrorServer);
    expect(apiErrorText(new ApiError("x", 400, "bad_request"), tGl as never, "fb")).toBe("fb");
  });

  it("stores scan failures as codes and renders them localized", () => {
    const err = new ApiError("English", 409, "badge_revoked");
    expect(scanFailureCode(err)).toBe("badge_revoked");
    expect(scanFailureCode(new ApiError("English", 418))).toBe("http_418");
    expect(scanFailureCode(new Error("offline"))).toBe("network");
    expect(scanFailureText("badge_revoked", tGl as never)).toBe(commonGl.apiError_badge_revoked);
    expect(scanFailureText("Some legacy English row", tGl as never)).toBe("requestError");
    expect(scanFailureText(SCAN_REPLAY_EXPIRED, tGl as never)).toBe("scanReplayExpired");
  });
});
