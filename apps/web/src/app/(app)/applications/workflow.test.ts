import { describe, expect, it } from "vitest";
import { pickText, type Translate } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import type { ResponseRow } from "./lib";
import {
  applicantTimelineState,
  applicationStatusLabel,
  availableApplicationWorkspaces,
  generatedFieldKey,
  rowsForWorkspace,
  type SaveState,
  saveStateLabel,
} from "./workflow";

const translate: Translate = (key) => key;
const row = (id: number, status: string): ResponseRow => ({
  id,
  user_id: id,
  name: `Applicant ${id}`,
  email: `applicant${id}@example.test`,
  shirt_size: null,
  food_intolerances: [],
  food_intolerance_notes: null,
  status,
  responses: {},
  staff_notes: null,
  submitted_at: "2026-07-17T10:00:00.000Z",
  decision_sent_at: null,
  confirmation_expires_at: null,
  confirmed_at: null,
  declined_at: null,
  avg_score: null,
  review_count: 0,
});

describe("application capability workspaces", () => {
  it("never gives publication workspaces to a reviewer without decision capability", () => {
    expect(availableApplicationWorkspaces({ manage: false, review: true, decide: false })).toEqual([
      "review",
    ]);
  });

  it("adds decision, communication, and confirmation without removing review", () => {
    expect(availableApplicationWorkspaces({ manage: true, review: true, decide: true })).toEqual([
      "builder",
      "review",
      "decisions",
      "communication",
      "confirmation",
    ]);
  });

  it("supports a decision-only account without inventing a role switch", () => {
    expect(availableApplicationWorkspaces({ manage: false, review: false, decide: true })).toEqual([
      "decisions",
      "communication",
      "confirmation",
    ]);
  });
});

describe("application lifecycle presentation", () => {
  const rows = [
    row(1, "review"),
    row(2, "accepted_internal"),
    row(3, "accepted"),
    row(4, "confirmed"),
    row(5, "declined"),
    row(6, "expired"),
  ];

  it("keeps internal decisions out of sent and confirmation workspaces", () => {
    expect(rowsForWorkspace(rows, "communication").map((item) => item.id)).toEqual([2, 3]);
    expect(rowsForWorkspace(rows, "confirmation").map((item) => item.id)).toEqual([3, 4, 5, 6]);
    expect(applicationStatusLabel("accepted_internal", translate)).toBe("acceptedInternalOnly");
    expect(applicationStatusLabel("accepted", translate)).toBe("acceptanceSent");
  });

  it("exposes every persistent save state", () => {
    expect(
      ["saved", "saving", "unsaved", "error"].map((state) =>
        saveStateLabel(state as SaveState, translate),
      ),
    ).toEqual(["saveStateSaved", "saveStateSaving", "saveStateUnsaved", "saveStateError"]);
  });

  it("advances the applicant timeline only after visible state transitions", () => {
    expect(applicantTimelineState("review", "2026-07-17T10:00:00Z")).toEqual({
      application: true,
      submitted: true,
      review: true,
      decision: false,
      place: false,
    });
    expect(applicantTimelineState("expired", "2026-07-17T10:00:00Z")).toMatchObject({
      decision: true,
      place: true,
    });
  });
});

describe("progressive question builder", () => {
  it("generates stable internal keys and resolves collisions without user input", () => {
    expect(generatedFieldKey("¿Por qué quieres venir?")).toBe("por_que_quieres_venir");
    expect(generatedFieldKey("Motivación", ["motivacion", "motivacion_2"])).toBe("motivacion_3");
  });

  it("uses the selected Spanish, Galician, or English applicant label in preview", () => {
    const label = { es: "Motivación", gl: "Motivación en galego", en: "Motivation" };
    expect(["es", "gl", "en"].map((locale) => pickText(label, locale as Language))).toEqual([
      "Motivación",
      "Motivación en galego",
      "Motivation",
    ]);
  });
});
