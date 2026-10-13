import { ERROR_REASONS } from "@hackos/shared/error-reasons";

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

import { ApiError } from "./api";
import type { ScheduleInput } from "./schedule";
import { prepareScheduleSubmission, scheduleSaveError } from "./schedule-save";

function form(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    title: "",
    description: null,
    location: null,
    type: null,
    requiresScan: false,
    startsAt: "2026-10-12T10:00:00.000Z",
    endsAt: "2026-10-12T11:00:00.000Z",
    visibility: "hidden",
    publishAt: null,
    audiences: [],
    contactNote: null,
    notes: null,
    ...overrides,
  };
}

describe("prepareScheduleSubmission", () => {
  it("accepts the editor's own language alone", () => {
    const result = prepareScheduleSubmission(form({ title: " Apertura " }), {});
    expect(result?.values.title).toBe("Apertura");
    expect(result?.values.titleLanguage).toBeUndefined();
  });

  it("promotes a single filled translation when the editor's language is blank", () => {
    const result = prepareScheduleSubmission(form(), {
      es: { title: "Apertura", description: "Bienvenida" },
      en: { title: "" },
    });
    expect(result?.values).toMatchObject({
      title: "Apertura",
      description: "Bienvenida",
      titleLanguage: "es",
    });
    expect(result?.translations).toEqual({});
  });

  it("keeps the other filled translations and drops blank fields", () => {
    const result = prepareScheduleSubmission(form(), {
      gl: { title: "Abertura", description: "" },
      en: { title: "Opening" },
    });
    expect(result?.values.titleLanguage).toBe("gl");
    expect(result?.translations).toEqual({ en: { title: "Opening" } });
  });

  it("rejects an entry with no title in any language", () => {
    expect(prepareScheduleSubmission(form(), { es: { description: "Solo texto" } })).toBeNull();
  });
});

describe("scheduleSaveError", () => {
  const t = (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key;

  it("reports a connection problem only for a request that never got a response", () => {
    expect(scheduleSaveError(new TypeError("Network request failed"), t)).toBe("scheduleSaveError");
  });

  it("maps known business errors to localized messages", () => {
    expect(
      scheduleSaveError(
        new ApiError("reworded", 400, "bad_request", {
          code: ERROR_REASONS.SCHEDULE_ENDS_BEFORE_STARTS,
        }),
        t,
      ),
    ).toBe("scheduleErrorEndBeforeStart");
    expect(
      scheduleSaveError(
        new ApiError("reworded", 404, "not_found", {
          code: ERROR_REASONS.SCHEDULE_ITEM_NOT_FOUND,
        }),
        t,
      ),
    ).toBe("scheduleErrorNotFound");
    expect(scheduleSaveError(new ApiError("Missing capability", 403, "forbidden"), t)).toBe(
      "scheduleErrorForbidden",
    );
  });

  it("never shows the server's English message for unmapped validation errors", () => {
    expect(
      scheduleSaveError(new ApiError("body/title must be shorter", 400, "validation"), t),
    ).toBe("scheduleSaveError");
  });
});
