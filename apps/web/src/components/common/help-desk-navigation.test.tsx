import { CAPABILITIES } from "@hackos/shared/capabilities";
import { getByRole, queryByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HelpDeskSectionHeader } from "./section-navigation";

const env = vi.hoisted(() => ({
  caps: [] as string[],
  eligible: true,
  path: "/help-desk",
  search: "tab=claims",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => env.path,
  useSearchParams: () => new URLSearchParams(env.search),
}));
vi.mock("@/lib/session", () => ({
  useSessionContext: () => ({
    can: (cap: string) => env.caps.includes(cap),
    canAny: (...caps: string[]) => caps.some((cap) => env.caps.includes(cap)),
  }),
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key} ${values.count}` : key),
  }),
}));
vi.mock("@/hooks/use-own-helper-profile", () => ({
  useOwnHelperProfile: () => ({ data: { eligible: env.eligible } }),
}));
vi.mock("@/hooks/use-helpdesk-schedule", () => ({
  useHelpdeskSchedule: () => ({ data: null, closed: false }),
}));
vi.mock("@/app/(app)/help-desk/requests/request-help-action", () => ({
  RequestHelpAction: () => null,
}));
vi.mock("@/app/(app)/help-desk/shared", () => ({
  useHelpdesk: () => ({
    data: {
      helpers: [
        { availableNow: true, scheduledNow: false },
        { availableNow: false, scheduledNow: true },
      ],
    },
  }),
}));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Object.assign(env, {
    caps: [
      CAPABILITIES.HELPDESK_REQUEST,
      CAPABILITIES.HELPDESK_OFFER,
      CAPABILITIES.HELPDESK_COVERAGE,
    ],
    eligible: true,
    path: "/help-desk",
    search: "tab=claims",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("keeps the selected view through the directory and counts actual availability, not schedule (H63)", async () => {
  await act(async () => root.render(<HelpDeskSectionHeader />));
  expect(
    getByRole(container, "link", { name: "helpDeskHelpers helpDeskAvailableCount 1" }).getAttribute(
      "href",
    ),
  ).toBe("/help-desk/helpers?tab=claims");
  env.path = "/help-desk/helpers";
  await act(async () => root.render(<HelpDeskSectionHeader />));
  expect(getByRole(container, "link", { name: "helpDeskAllRequests" }).getAttribute("href")).toBe(
    "/help-desk?tab=claims",
  );
  expect(queryByRole(container, "link", { name: "helpDeskInbox" })).toBeNull();
});
it("offers opening hours only with the manage capability (H64)", async () => {
  await act(async () => root.render(<HelpDeskSectionHeader />));
  await act(async () =>
    userEvent.click(getByRole(container, "button", { name: "helpDeskOptions" })),
  );
  expect(queryByRole(document.body, "menuitem", { name: "helpDeskHours" })).toBeNull();
});
it("puts coverage and the eligible profile in the menu and respects combinations", async () => {
  await act(async () => root.render(<HelpDeskSectionHeader />));
  await act(async () =>
    userEvent.click(getByRole(container, "button", { name: "helpDeskOptions" })),
  );
  expect(
    getByRole(document.body, "menuitem", { name: "helpDeskCoverage" }).getAttribute("href"),
  ).toBe("/help-desk/coverage");
  expect(
    getByRole(document.body, "menuitem", { name: "helpDeskMySupportProfile" }).getAttribute("href"),
  ).toBe("/settings/profile?tab=public");
  await act(async () => userEvent.keyboard("{Escape}"));
  env.caps = [CAPABILITIES.HELPDESK_REQUEST];
  env.eligible = false;
  await act(async () => root.render(<HelpDeskSectionHeader />));
  expect(queryByRole(container, "button", { name: "helpDeskOptions" })).toBeNull();
});
