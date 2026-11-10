import { describe, expect, it } from "vitest";
import {
  askableKinds,
  draftBlocked,
  draftFromItems,
  draftToBody,
  type RsvpItem,
  type RsvpSettingsDraft,
  rsvpBody,
  settingsDraftError,
} from "./rsvp";

function item(overrides: Partial<RsvpItem> = {}): RsvpItem {
  return {
    activityId: 1,
    name: "Lunch",
    description: null,
    date: "2026-10-20T12:00:00.000Z",
    closesAt: "2026-10-19T12:00:00.000Z",
    location: null,
    required: false,
    answer: null,
    allowsUnsure: true,
    locked: false,
    isMeal: true,
    ...overrides,
  };
}

describe("rsvpBody", () => {
  it("sends only open, changed, answered items", () => {
    const items = [
      item({ activityId: 1, answer: "yes" }),
      item({ activityId: 2 }),
      item({ activityId: 3, locked: true, answer: "no" }),
      item({ activityId: 4, answer: "no" }),
    ];
    const draft = draftFromItems(items);
    draft[2] = { answer: "unsure" };
    draft[4] = { answer: "yes" };
    expect(rsvpBody(items, draft)).toEqual({
      answers: [
        { activityId: 2, answer: "unsure" },
        { activityId: 4, answer: "yes" },
      ],
    });
  });
});

describe("draftBlocked", () => {
  it("lets optional items stay unanswered", () => {
    const items = [item()];
    expect(draftBlocked(items, draftFromItems(items))).toBe(false);
  });

  it("blocks a required item that is unanswered or unsure", () => {
    const items = [item({ required: true, allowsUnsure: false })];
    const draft = draftFromItems(items);
    expect(draftBlocked(items, draft)).toBe(true);
    draft[1] = { answer: "unsure" };
    expect(draftBlocked(items, draft)).toBe(true);
    draft[1] = { answer: "no" };
    expect(draftBlocked(items, draft)).toBe(false);
  });

  it("ignores locked items", () => {
    const items = [item({ required: true, locked: true })];
    expect(draftBlocked(items, draftFromItems(items))).toBe(false);
  });
});

describe("settings helpers", () => {
  const draft = (overrides: Partial<RsvpSettingsDraft> = {}): RsvpSettingsDraft => ({
    enabled: true,
    required: true,
    kinds: ["sponsor", "participant"],
    nameI18n: { es: "Comida", en: " ", gl: "" },
    descriptionI18n: {},
    rsvpDate: "",
    closesAt: "",
    ...overrides,
  });

  it("never asks participants about a meal", () => {
    expect(askableKinds(true)).toEqual(["mentor", "sponsor", "staff"]);
    expect(askableKinds(false)).toContain("participant");
    expect(draftToBody(draft(), () => null, true).kinds).toEqual(["sponsor"]);
  });

  it("drops blank translations and a required flag on a disabled RSVP", () => {
    const body = draftToBody(draft({ enabled: false }), () => null, false);
    expect(body).toMatchObject({
      enabled: false,
      required: false,
      nameI18n: { es: "Comida" },
      descriptionI18n: null,
    });
  });

  it("reports what blocks saving", () => {
    expect(settingsDraftError(draft())).toBeNull();
    expect(settingsDraftError(draft({ kinds: [] }))).toBe("rsvpKindsRequired");
    expect(settingsDraftError(draft({ enabled: false, kinds: [] }))).toBeNull();
  });
});
