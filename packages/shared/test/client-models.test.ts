import { describe, expect, it } from "vitest";
import { parseAccountRemovalProgress } from "../src/account-removal";
import {
  announcementToForm,
  emptyAnnouncementForm,
  targetingModeOf,
} from "../src/announcement-form";
import { roleDisplayName, scheduleTypeLabel } from "../src/display-labels";
import { deviceTimeZone } from "../src/event-time";
import { createEventTimeZoneStore } from "../src/event-time-store";
import {
  resolveActivityText,
  resolveLocalizedText,
  resolveScheduleText,
} from "../src/localized-text";
import {
  durationMinutes,
  guaranteedMinutes,
  provisionalMinutes,
  securedWindowFraction,
} from "../src/presence-timeline";
import {
  prepareScheduleSubmission,
  type ScheduleFormItem,
  scheduleItemToForm,
  scheduleItemToTranslations,
} from "../src/schedule-form";

const item: ScheduleFormItem = {
  title: "Título",
  description: "Descrición",
  primaryLanguage: "gl",
  titleI18n: { en: "Title", es: "Título ES" },
  descriptionI18n: { en: "Description" },
  startsAt: "2026-10-13T10:00:00Z",
  endsAt: "2026-10-13T11:00:00Z",
};
describe("shared schedule form (#1001)", () => {
  it("trims canonical and translated titles without mutating the editor state", () => {
    const values = { ...scheduleItemToForm(item, "gl"), title: "  Title  " };
    expect(
      prepareScheduleSubmission(values, { en: { title: " English ", description: " " } }),
    ).toEqual({
      values: { ...values, title: "Title" },
      translations: { en: { title: "English" } },
    });
    expect(values.title).toBe("  Title  ");
  });
  it("promotes the first filled translation and removes it from translations", () => {
    const values = { ...scheduleItemToForm(item, "gl"), title: " " };
    expect(
      prepareScheduleSubmission(values, {
        es: { title: " ", description: " ignored " },
        gl: { title: " Nome ", description: " Texto " },
        en: { title: " Name " },
      }),
    ).toEqual({
      values: { ...values, title: "Nome", description: "Texto", titleLanguage: "gl" },
      translations: { es: { description: "ignored" }, en: { title: "Name" } },
    });
    expect(
      prepareScheduleSubmission(values, { en: { description: "Only description" } }),
    ).toBeNull();
  });
  it("keeps a missing translated description null and edits only the viewer language", () => {
    expect(scheduleItemToForm(item, "es")).toMatchObject({ title: "Título ES", description: null });
    expect(scheduleItemToForm({ ...item, titleI18n: {} }, "en")).toMatchObject({
      title: "",
      description: "Description",
    });
    expect(scheduleItemToForm(item, "gl")).toMatchObject({
      title: "Título",
      description: "Descrición",
    });
    expect(scheduleItemToTranslations(item, "es")).toEqual({
      gl: { title: "Título", description: "Descrición" },
      en: { title: "Title", description: "Description" },
    });
  });
  it("preserves scheduling, targeting, scanning and private fields", () => {
    const full = {
      ...item,
      location: "Room",
      type: "meal",
      requiresScan: true,
      visibility: "shown" as const,
      publishAt: item.startsAt,
      audiences: ["participant" as const],
      liveActivityAudience: true,
      contactNote: "Contact",
      notes: "Private",
    };
    const { primaryLanguage, titleI18n, descriptionI18n, ...fields } = full;
    expect(scheduleItemToForm(full, "gl")).toMatchObject(fields);
  });
});
describe("localized content (#1001)", () => {
  it.each(["es", "gl", "en"] as const)("uses preferred content for %s", (language) => {
    const translations = { es: "ES", gl: "GL", en: "EN" };
    expect(resolveLocalizedText("Authored", translations, language, language)).toBe("Authored");
  });
  it("falls back per field to English then authored text, skipping whitespace", () => {
    expect(resolveScheduleText(item, "es")).toEqual({
      title: "Título ES",
      description: "Description",
    });
    expect(resolveLocalizedText("Authored", { es: " ", en: "English" }, "gl", "es")).toBe(
      "English",
    );
    expect(resolveLocalizedText("Authored", { es: " ", en: " " }, "gl", "es")).toBe("Authored");
    expect(resolveLocalizedText(null, {}, "gl", "es")).toBeNull();
    expect(
      resolveActivityText(
        { name: "Nome", primaryLanguage: "gl", nameI18n: { es: " ", en: "Name" } },
        "es",
      ),
    ).toBe("Name");
  });
});
describe("announcement form (#1001)", () => {
  it("hydrates all fields and provides missing locale/channel defaults", () => {
    expect(
      announcementToForm({
        title: "Title",
        body: "Body",
        notify_users: true,
        screen_placement: "fullscreen",
        publish_at: item.startsAt,
        expires_at: item.endsAt,
        role_ids: [1],
        intolerance_ids: [2],
        recipients: [{ id: 3 }],
      }),
    ).toEqual({
      ...emptyAnnouncementForm(),
      title: "Title",
      body: "Body",
      translations: {
        es: { title: "Title", body: "Body" },
        gl: { title: "", body: "" },
        en: { title: "", body: "" },
      },
      notifyUsers: true,
      screenPlacement: "fullscreen",
      publishAt: item.startsAt,
      expiresAt: item.endsAt,
      roleIds: [1],
      intoleranceIds: [2],
      recipientUserIds: [3],
    });
  });
  it("preserves explicit translations and channels; fresh forms do not share state", () => {
    const form = emptyAnnouncementForm();
    form.roleIds.push(1);
    form.translations.es = { title: "Changed", body: "Changed" };
    expect(emptyAnnouncementForm().roleIds).toEqual([]);
    expect(emptyAnnouncementForm().translations.es?.title).toBe("");
    expect(
      announcementToForm({
        title: "Title",
        body: "Body",
        translations: { es: { title: "ES", body: "ES" } },
        notify_users: false,
        screen_placement: "none",
        publish_at: null,
        expires_at: null,
        channels: [],
      }),
    ).toMatchObject({ channels: [], translations: { es: { title: "ES", body: "ES" } } });
  });
  it("derives exclusive targeting modes", () => {
    expect(targetingModeOf(emptyAnnouncementForm())).toBe("everyone");
    expect(targetingModeOf({ ...emptyAnnouncementForm(), intoleranceIds: [1] })).toBe("roles");
    expect(
      targetingModeOf({ ...emptyAnnouncementForm(), roleIds: [1], recipientUserIds: [2] }),
    ).toBe("specific");
  });
});
describe("presence math (#1001)", () => {
  const window = {
    start: item.startsAt,
    deadline: item.endsAt,
    securedUntil: "2026-10-13T10:30:00Z",
  };
  it("clamps negative and invalid dates and rounds minutes", () => {
    expect(durationMinutes(item.startsAt, item.endsAt)).toBe(60);
    expect(durationMinutes(item.endsAt, item.startsAt)).toBe(0);
    expect(durationMinutes("invalid", item.endsAt)).toBe(0);
    expect(durationMinutes(item.startsAt, "invalid")).toBe(0);
    expect(durationMinutes(item.startsAt, "2026-10-13T10:00:31Z")).toBe(1);
  });
  it("sums only secured windows and bounds fractions", () => {
    expect(
      guaranteedMinutes([
        window,
        { ...window, securedUntil: null },
        { ...window, securedUntil: "invalid" },
      ]),
    ).toBe(30);
    expect(securedWindowFraction(window)).toBe(0.5);
    expect(securedWindowFraction({ ...window, securedUntil: "invalid" })).toBe(0);
    expect(securedWindowFraction({ ...window, securedUntil: "2026-10-13T12:00:00Z" })).toBe(1);
    expect(securedWindowFraction({ ...window, deadline: window.start })).toBe(0);
  });
  it("caps provisional time at the deadline, excluding secured/invalid windows", () => {
    const provisional = { ...window, securedUntil: null, status: "provisional" };
    expect(
      provisionalMinutes(
        [provisional, { ...window, status: "secured" }, { ...provisional, status: "invalid" }],
        Date.parse("2026-10-13T12:00:00Z"),
      ),
    ).toBe(60);
    expect(provisionalMinutes([{ ...provisional, deadline: "invalid" }])).toBe(0);
    expect(provisionalMinutes([provisional], Date.parse("2026-10-13T09:00:00Z"))).toBe(0);
  });
});
describe("supporting shared helpers (#1001)", () => {
  it("keeps authored roles and category label keys", () => {
    expect(roleDisplayName("Custom role", (key) => key)).toBe("Custom role");
    expect(roleDisplayName(null, (key) => key)).toBe("roleUnassigned");
    expect(scheduleTypeLabel("unknown", (key) => key)).toBe(
      scheduleTypeLabel("activity", (key) => key),
    );
  });
  it("accepts only valid non-identifying removal progress", () => {
    expect(
      parseAccountRemovalProgress('{"action":"delete","status":"processing","userId":123}'),
    ).toEqual({ action: "delete", status: "processing" });
    for (const raw of [
      null,
      "broken",
      "[]",
      '{"action":"delete","status":"done"}',
      '{"action":"other","status":"processing"}',
    ])
      expect(parseAccountRemovalProgress(raw)).toBeNull();
  });
  it("isolates timezone stores and only notifies when a valid value changes", () => {
    const first = createEventTimeZoneStore(),
      second = createEventTimeZoneStore();
    let calls = 0;
    const unsubscribe = first.subscribe(() => calls++);
    first.setEventTimeZone("Europe/Madrid");
    first.setEventTimeZone("Europe/Madrid");
    expect(calls).toBe(1);
    expect(first.getEventTimeZone()).toBe("Europe/Madrid");
    expect(second.getEventTimeZone()).toBe(deviceTimeZone());
    first.setEventTimeZone("invalid");
    expect(calls).toBe(2);
    expect(first.getEventTimeZone()).toBe(deviceTimeZone());
    unsubscribe();
    first.setEventTimeZone("UTC");
    expect(calls).toBe(2);
  });
});
