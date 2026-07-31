import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import type { Translate } from "@/lib/i18n";
import {
  fieldErrorsFromApi,
  fmtDateTime,
  formTypeLabel,
  isConfirmationExpiredError,
  statusLabel,
} from "./lib";

const translate: Translate = (key) => key;

describe("participant application presentation", () => {
  it("does not expose an unknown API status as user-facing copy", () => {
    expect(statusLabel("accepted_internal", translate)).toBe("unknownStatus");
  });

  it("localizes application types instead of exposing enum values", () => {
    expect(formTypeLabel("participant", translate)).toBe("applicationTypeParticipant");
    expect(formTypeLabel("future_type", translate)).toBe("applicationTypeOther");
  });

  it("formats dates using the selected locale", () => {
    const english = fmtDateTime("2026-07-17T10:00:00.000Z", "en");
    const spanish = fmtDateTime("2026-07-17T10:00:00.000Z", "es");

    expect(english).toContain("2026");
    expect(spanish).toContain("2026");
    expect(english).not.toBe(spanish);
  });

  it("maps API field validation to localized field messages", () => {
    const error = new ApiError(400, "validation_error", "Invalid response", {
      fields: { name: "required", age: "must be a number", link: "other" },
    });
    expect(fieldErrorsFromApi(error, translate)).toEqual({
      name: "fieldRequired",
      age: "fieldMustBeNumber",
      link: "fieldInvalid",
    });
  });

  it("recognizes an expired confirmation response", () => {
    expect(
      isConfirmationExpiredError(
        new ApiError(409, "conflict", "Expired", { code: "confirmation_expired" }),
      ),
    ).toBe(true);
  });
});
