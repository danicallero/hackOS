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
  slugifyOptionKey,
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
    options: [],
    answer: null,
    optionKey: null,
    optionLabel: null,
    allowsUnsure: true,
    optionRetired: false,
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
    draft[2] = { answer: "unsure", optionKey: null };
    draft[4] = { answer: "yes", optionKey: null };
    expect(rsvpBody(items, draft)).toEqual({
      answers: [
        { activityId: 2, answer: "unsure" },
        { activityId: 4, answer: "yes" },
      ],
    });
  });

  it("carries the option for a yes and never for a no", () => {
    const options = [{ key: "veg", label: "Vegetarian" }];
    const items = [item({ options })];
    const draft = draftFromItems(items);
    draft[1] = { answer: "yes", optionKey: "veg" };
    expect(rsvpBody(items, draft).answers).toEqual([
      { activityId: 1, answer: "yes", optionKey: "veg" },
    ]);
    draft[1] = { answer: "no", optionKey: null };
    expect(rsvpBody(items, draft).answers).toEqual([{ activityId: 1, answer: "no" }]);
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
    draft[1] = { answer: "unsure", optionKey: null };
    expect(draftBlocked(items, draft)).toBe(true);
    draft[1] = { answer: "no", optionKey: null };
    expect(draftBlocked(items, draft)).toBe(false);
  });

  it("blocks a yes without a live option, including a retired stored one", () => {
    const options = [{ key: "std", label: "Standard" }];
    const items = [
      item({ options, answer: "yes", optionKey: "veg", optionRetired: true, optionLabel: "Veg" }),
    ];
    const draft = draftFromItems(items);
    expect(draftBlocked(items, draft)).toBe(true);
    draft[1] = { answer: "yes", optionKey: "std" };
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
    options: [{ key: "std", labelI18n: { en: "Standard", es: "" } }],
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
      options: [{ key: "std", labelI18n: { en: "Standard" } }],
    });
  });

  it("reports what blocks saving", () => {
    expect(settingsDraftError(draft())).toBeNull();
    expect(settingsDraftError(draft({ kinds: [] }))).toBe("rsvpKindsRequired");
    expect(settingsDraftError(draft({ enabled: false, kinds: [] }))).toBeNull();
    expect(settingsDraftError(draft({ options: [{ key: "a", labelI18n: { en: " " } }] }))).toBe(
      "rsvpOptionLabelRequired",
    );
  });

  it("derives stable unique option keys", () => {
    expect(slugifyOptionKey("Vegetariano sin gluten!", new Set())).toBe("vegetariano_sin_gluten");
    expect(slugifyOptionKey("Normal", new Set(["normal", "normal_2"]))).toBe("normal_3");
    expect(slugifyOptionKey("¡¿", new Set())).toBe("option");
  });
});
