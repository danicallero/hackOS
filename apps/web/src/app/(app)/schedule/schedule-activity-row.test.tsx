import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { ActivityRow } from "./schedule-activity-row";

// #966: the roster shows whether an entry displays a Live Activity.

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n")>()),
  useLocale: () => ({ t: (key: string) => key, language: "en" }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function renderCell(liveActivityAudience: boolean | undefined): string {
  const item: PublicScheduleItem = {
    id: 1,
    title: "Workshop",
    description: null,
    location: null,
    type: "workshop",
    requiresScan: false,
    startsAt: "2026-07-22T13:00:00.000Z",
    endsAt: "2026-07-22T14:00:00.000Z",
    visibility: "shown",
    publishAt: null,
    audiences: ["participant"],
    liveActivityAudience,
    primaryLanguage: "en",
    titleI18n: {},
    descriptionI18n: {},
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      <table>
        <tbody>
          <ActivityRow
            item={item}
            dayKey="2026-07-22"
            columns={["liveActivity"]}
            canEdit={false}
            selected={false}
            onToggleSelected={() => {}}
            onUpdate={() => {}}
            onOpenEdit={() => {}}
            onDuplicate={() => {}}
            onDelete={() => {}}
          />
        </tbody>
      </table>,
    );
  });
  const text = container.querySelector("td")?.textContent ?? "";
  act(() => root.unmount());
  return text;
}

describe("ActivityRow liveActivity column", () => {
  it("reads yes when the entry shows a Live Activity", () => {
    expect(renderCell(true)).toBe("yesLabel");
  });

  it("reads no otherwise, including when the field is absent", () => {
    expect(renderCell(false)).toBe("noLabel");
    expect(renderCell(undefined)).toBe("noLabel");
  });
});
