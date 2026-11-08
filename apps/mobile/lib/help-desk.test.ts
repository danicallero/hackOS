import { CAPABILITIES } from "@hackos/shared/capabilities";
import helpDeskEn from "@hackos/shared/locales/en/mobile.json";
import helpDeskEs from "@hackos/shared/locales/es/mobile.json";
import helpDeskGl from "@hackos/shared/locales/gl/mobile.json";
import { canBrowseHelpDesk, validAvailability, validHelpRequest } from "./help-desk";

jest.mock("./api", () => ({ apiFetch: jest.fn() }));
const interval = (start: string, end: string) => ({
  startsAt: `2027-02-${start}:00.000Z`,
  endsAt: `2027-02-${end}:00.000Z`,
});

describe("help desk boundaries (H61–H67)", () => {
  it("combines capabilities without granting access from a display role", () => {
    expect(canBrowseHelpDesk([])).toBe(false);
    expect(canBrowseHelpDesk([CAPABILITIES.HELPDESK_MANAGE])).toBe(false);
    for (const capability of [
      CAPABILITIES.ADMIN_ALL,
      CAPABILITIES.HELPDESK_REQUEST,
      CAPABILITIES.HELPDESK_OFFER,
      CAPABILITIES.HELPDESK_COVERAGE,
    ]) {
      expect(canBrowseHelpDesk([capability])).toBe(true);
    }
  });
  it("allows multiple days, adjoining intervals, an unordered set and clearing the schedule", () => {
    expect(validAvailability([])).toBe(true);
    expect(
      validAvailability([interval("20T09:00", "20T10:00"), interval("21T09:00", "21T10:00")]),
    ).toBe(true);
    expect(
      validAvailability([interval("20T10:00", "20T11:00"), interval("20T09:00", "20T10:00")]),
    ).toBe(true);
  });
  it("rejects overlaps, reversed/invalid dates, intervals longer than a day and excess intervals", () => {
    expect(
      validAvailability([interval("20T09:00", "20T11:00"), interval("20T10:00", "20T12:00")]),
    ).toBe(false);
    expect(validAvailability([interval("20T11:00", "20T09:00")])).toBe(false);
    expect(validAvailability([{ startsAt: "invalid", endsAt: "invalid" }])).toBe(false);
    expect(validAvailability([interval("20T09:00", "21T10:00")])).toBe(false);
    expect(
      validAvailability(Array.from({ length: 31 }, () => interval("20T09:00", "20T10:00"))),
    ).toBe(false);
  });
  it("requires a real description, location and a topic or Other within API bounds", () => {
    const topic = { id: 1, name: "Frontend" };
    expect(validHelpRequest("Debug a build", "Desk 5", [topic], false)).toBe(true);
    expect(validHelpRequest("Other need", "Desk 5", [], true)).toBe(true);
    expect(validHelpRequest("Need help", "Desk 5", [], false)).toBe(false);
    expect(validHelpRequest(" ", "Desk 5", [topic], false)).toBe(false);
    expect(validHelpRequest("Need help", " ", [topic], false)).toBe(false);
    expect(validHelpRequest("x".repeat(501), "Desk 5", [topic], false)).toBe(false);
    expect(validHelpRequest("Need help", "x".repeat(121), [topic], false)).toBe(false);
    expect(
      validHelpRequest(
        "Need help",
        "Desk 5",
        Array.from({ length: 6 }, () => topic),
        false,
      ),
    ).toBe(false);
  });
  it("ships the same complete copy in Spanish, Galician and English", () => {
    expect(Object.keys(helpDeskEs).sort()).toEqual(Object.keys(helpDeskEn).sort());
    expect(Object.keys(helpDeskGl).sort()).toEqual(Object.keys(helpDeskEn).sort());
    for (const dictionary of [helpDeskEn, helpDeskEs, helpDeskGl]) {
      const help = Object.entries(dictionary).filter(([key]) => key.startsWith("help"));
      expect(help.length).toBeGreaterThan(40);
      expect(help.every(([, value]) => String(value).trim().length > 0)).toBe(true);
    }
  });
});
