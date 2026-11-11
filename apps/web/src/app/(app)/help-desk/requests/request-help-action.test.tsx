import { getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEventTimeZone } from "@/lib/event-time";
import { HelpdeskClosedNotice } from "./closed-notice";
import { RequestHelpAction } from "./request-help-action";

let schedule: { eventAccessOnly: true; open: boolean; nextChangeAt: string | null } | null = null;
vi.mock("@/hooks/use-helpdesk-schedule", () => ({
  useHelpdeskSchedule: () => ({ data: schedule, closed: schedule?.open === false }),
}));
vi.mock("@/lib/session", () => ({ useCan: () => true }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/help-desk",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./request-editor", () => ({ RequestEditor: () => null }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  setEventTimeZone("UTC");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
describe("help desk closed state (H64)", () => {
  it("disables Request help only when the schedule says closed", async () => {
    schedule = { eventAccessOnly: true, open: false, nextChangeAt: "2027-02-27T10:00:00.000Z" };
    await act(async () => root.render(<RequestHelpAction />));
    expect(
      getByRole(container, "button", { name: "helpDeskRequestHelp" }).hasAttribute("disabled"),
    ).toBe(true);
    schedule = { eventAccessOnly: true, open: true, nextChangeAt: null };
    await act(async () => root.render(<RequestHelpAction />));
    expect(
      getByRole(container, "button", { name: "helpDeskRequestHelp" }).hasAttribute("disabled"),
    ).toBe(false);
    schedule = null;
    await act(async () => root.render(<RequestHelpAction />));
    expect(
      getByRole(container, "button", { name: "helpDeskRequestHelp" }).hasAttribute("disabled"),
    ).toBe(false);
  });
  it("says when it opens, or just that it is closed", async () => {
    const closed = {
      eventAccessOnly: true,
      configured: true,
      open: false,
      windows: [],
      suggestedInterval: null,
    };
    await act(async () =>
      root.render(
        <HelpdeskClosedNotice schedule={{ ...closed, nextChangeAt: "2027-02-27T10:00:00.000Z" }} />,
      ),
    );
    expect(container.textContent).toContain("helpDeskClosedOpens");
    await act(async () =>
      root.render(<HelpdeskClosedNotice schedule={{ ...closed, nextChangeAt: null }} />),
    );
    expect(container.textContent).toBe("helpDeskClosed");
    await act(async () =>
      root.render(
        <HelpdeskClosedNotice schedule={{ ...closed, open: true, nextChangeAt: null }} />,
      ),
    );
    expect(container.textContent).toBe("");
  });
});
