import { ERROR_REASONS, errorReasonCopyKey } from "@hackos/shared/error-reasons";
import commonEn from "@hackos/shared/locales/en/common.json";
import commonEs from "@hackos/shared/locales/es/common.json";
import commonGl from "@hackos/shared/locales/gl/common.json";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { translateMessage } from "@/lib/i18n";

const tGl = (key: Parameters<typeof translateMessage>[1]) => translateMessage("gl", key);

describe("apiErrorText", () => {
  it("resolves a known reason to localized copy, never the English message", () => {
    const err = new ApiError(409, "conflict", "English server text", {
      code: ERROR_REASONS.IDEMPOTENCY_IN_FLIGHT,
    });
    const text = apiErrorText(err, tGl, "fallback");
    expect(text).toBe(commonGl.apiError_idempotency_in_flight);
    expect(text).not.toContain("English server text");
  });

  it("uses generic localized copy by status for unknown reasons", () => {
    expect(apiErrorText(new ApiError(403, "forbidden", "No"), tGl, "fb")).toBe(
      commonGl.apiErrorForbidden,
    );
    expect(apiErrorText(new ApiError(500, "internal", "Boom"), tGl, "fb")).toBe(
      commonGl.apiErrorServer,
    );
  });

  it("falls back to the caller's localized copy for an unknown business reason", () => {
    const err = new ApiError(409, "conflict", "English only", { code: "something_new" });
    expect(apiErrorText(err, tGl, "fb")).toBe("fb");
    expect(apiErrorText(new Error("network"), tGl, "fb")).toBe("fb");
  });

  it("has es/gl/en copy for every shared reason", () => {
    for (const reason of Object.values(ERROR_REASONS)) {
      const key = errorReasonCopyKey(reason);
      for (const dict of [commonEn, commonEs, commonGl]) {
        expect((dict as Record<string, string>)[key], key).toBeTruthy();
      }
    }
  });
});
