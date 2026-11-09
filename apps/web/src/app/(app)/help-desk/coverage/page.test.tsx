import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CoverageReport } from "../model";
import { NowSection } from "./page";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "en", t: (key: string) => key }) }));
it("keeps scheduled and present totals independent when unscheduled helpers are present (H67)", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const report = {
    now: { at: "2027-02-27T10:00:00Z", scheduled: 1, present: 3, available: 3, topics: [] },
  } as unknown as CoverageReport;
  try {
    await act(async () => root.render(<NowSection report={report} />));
    expect([...container.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
      "helpDeskScheduledCount",
      "helpDeskPresent",
    ]);
    expect([...container.querySelectorAll("dd")].map((node) => node.textContent)).toEqual([
      "1",
      "3",
    ]);
    expect(container.textContent).not.toContain("helpDeskNotInsideCount");
    expect(container.textContent).not.toContain("helpDeskNotScheduledCount");
  } finally {
    await act(async () => root.unmount());
  }
});
