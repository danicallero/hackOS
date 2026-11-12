import { CAPABILITIES } from "@hackos/shared/capabilities";
import helpDeskEn from "@hackos/shared/locales/en/mobile.json";
import helpDeskEs from "@hackos/shared/locales/es/mobile.json";
import helpDeskGl from "@hackos/shared/locales/gl/mobile.json";
import { apiFetch } from "./api";
import { canBrowseHelpDesk, helpMutation, planDays } from "./help-desk";

jest.mock("./api", () => ({ apiFetch: jest.fn() }));
describe("help desk boundaries (H61–H67)", () => {
  it("sends body-less actions without a JSON content type (H64, H66)", async () => {
    // The API rejects an empty body declared as JSON, which broke cancel, release and resolve.
    await helpMutation("/api/helpdesk/requests/3/cancel");
    expect(apiFetch).toHaveBeenLastCalledWith("/api/helpdesk/requests/3/cancel", {
      method: "POST",
    });
    await helpMutation("/api/helpdesk/requests/3/claim", { mode: "on_my_way" });
    expect(apiFetch).toHaveBeenLastCalledWith("/api/helpdesk/requests/3/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "on_my_way" }),
    });
  });
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

describe("filterHelpers (H63)", () => {
  const card = (
    userId: number,
    name: string,
    kind: "mentor" | "sponsor" | "staff",
    topics: number[],
  ) =>
    ({
      userId,
      displayName: name,
      kind,
      topics: topics.map((id) => ({ id, name: `T${id}` })),
    }) as unknown as import("@/lib/help-desk").HelperCard;
  const list = [
    card(1, "Ada", "mentor", [1]),
    card(2, "Bo", "sponsor", [1, 2]),
    card(3, "Cy", "staff", []),
  ];
  it("combines roles, knowledge and search", () => {
    const { filterHelpers } = require("./help-desk");
    expect(filterHelpers(list, { query: "", kinds: [], topicIds: [] })).toHaveLength(3);
    expect(
      filterHelpers(list, { query: "", kinds: ["mentor", "sponsor"], topicIds: [] }),
    ).toHaveLength(2);
    expect(
      filterHelpers(list, { query: "", kinds: [], topicIds: [2] }).map(
        (h: { userId: number }) => h.userId,
      ),
    ).toEqual([2]);
    expect(
      filterHelpers(list, { query: "t1", kinds: ["sponsor"], topicIds: [1] }).map(
        (h: { userId: number }) => h.userId,
      ),
    ).toEqual([2]);
    expect(filterHelpers(list, { query: "zz", kinds: [], topicIds: [] })).toEqual([]);
  });
});

describe("planDays (H62)", () => {
  const window = { startsAt: "2026-11-27T09:00:00.000Z", endsAt: "2026-11-29T15:00:00.000Z" };
  it("lists every hacking day with its stated ranges", () => {
    const days = planDays(
      window,
      [{ startsAt: "2026-11-28T10:00:00.000Z", endsAt: "2026-11-28T12:00:00.000Z" }],
      "en",
    );
    expect(days.map((day) => day.key)).toEqual(["2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(days.map((day) => day.ranges.length)).toEqual([0, 1, 0]);
  });
  it("keeps a day outside the window that holds a range, and works without a window", () => {
    const days = planDays(
      null,
      [{ startsAt: "2026-12-01T10:00:00.000Z", endsAt: "2026-12-01T11:00:00.000Z" }],
      "en",
    );
    expect(days.map((day) => day.key)).toEqual(["2026-12-01"]);
  });
});
