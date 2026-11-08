import { CAPABILITIES } from "@hackos/shared/capabilities";
import helpDeskEn from "@hackos/shared/locales/en/mobile.json";
import helpDeskEs from "@hackos/shared/locales/es/mobile.json";
import helpDeskGl from "@hackos/shared/locales/gl/mobile.json";
import { canBrowseHelpDesk } from "./help-desk";

jest.mock("./api", () => ({ apiFetch: jest.fn() }));
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
