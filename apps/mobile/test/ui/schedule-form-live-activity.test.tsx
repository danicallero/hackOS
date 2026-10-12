import { scheduleItemToForm } from "@/components/schedule-form-modal";
import type { AdminScheduleItem } from "@/lib/schedule";

jest.mock("@/lib/auth-client", () => ({ authClient: {} }));
jest.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, apiFetch: jest.fn() }));

// #966: the schedule editor carries the attendee Live Activity opt-in.

describe("scheduleItemToForm liveActivityAudience", () => {
  const base = {
    id: 1,
    title: "Keynote",
    description: null,
    location: null,
    type: "talk",
    requiresScan: false,
    startsAt: "2026-07-22T13:00:00.000Z",
    endsAt: "2026-07-22T14:00:00.000Z",
    visibility: "shown",
    publishAt: null,
    audiences: ["participant"],
    contactNote: null,
    notes: null,
    owners: [],
    primaryLanguage: "en",
    titleI18n: {},
    descriptionI18n: {},
  } as unknown as AdminScheduleItem;

  it("loads the stored opt-in into the form", () => {
    expect(
      scheduleItemToForm({ ...base, liveActivityAudience: true }, "en").liveActivityAudience,
    ).toBe(true);
  });

  it("defaults to off when the item has none", () => {
    expect(scheduleItemToForm(base, "en").liveActivityAudience).toBe(false);
  });
});
