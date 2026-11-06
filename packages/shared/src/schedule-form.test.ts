import { describe, expect, it } from "vitest";
import { prepareScheduleSubmission, type ScheduleInput } from "./schedule-form.js";

describe("prepareScheduleSubmission", () => {
  const base: ScheduleInput = {
    title: "",
    description: null,
    location: null,
    type: null,
    requiresScan: false,
    audiences: [],
    publishAt: null,
    contactNote: null,
    notes: null,
    startsAt: "2026-10-12T10:00:00.000Z",
    endsAt: "2026-10-12T11:00:00.000Z",
    visibility: "hidden",
  };

  it("accepts the editor's own language alone", () => {
    expect(prepareScheduleSubmission({ ...base, title: "Apertura" }, {})?.values.title).toBe(
      "Apertura",
    );
  });

  it("promotes a single filled translation when the editor's language is blank", () => {
    const result = prepareScheduleSubmission(base, {
      gl: { title: "Abertura", description: "Benvida" },
      en: { title: "" },
    });
    expect(result?.values).toMatchObject({
      title: "Abertura",
      description: "Benvida",
      titleLanguage: "gl",
    });
    expect(result?.translations).toEqual({});
  });

  it("rejects an entry with no title in any language", () => {
    expect(prepareScheduleSubmission(base, { es: { description: "Solo texto" } })).toBeNull();
  });
});
