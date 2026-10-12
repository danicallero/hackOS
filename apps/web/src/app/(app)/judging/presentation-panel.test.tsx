import { fireEvent, getByRole, queryByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QueueEntry } from "@/lib/queue";
import { PresentationPanel } from "./presentation-panel";

const t = (key: string) => key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(entry: Partial<QueueEntry>, onEntryAction = vi.fn()) {
  act(() =>
    root.render(
      <PresentationPanel
        entry={
          {
            id: 7,
            repo_name: "Team",
            presentation_started_at: new Date().toISOString(),
            ...entry,
          } as QueueEntry
        }
        challenge={null}
        waitingRoomCount={0}
        firstCalledEntry={null}
        canJudge
        canOperate={false}
        busy={null}
        onEntryAction={onEntryAction}
      />,
    ),
  );
  return onEntryAction;
}

// #926: the timer control follows the shared judging state machine.
it("offers resume for a paused presentation and sends that one action", () => {
  const onEntryAction = render({
    status: "presenting",
    presentation_paused_at: new Date().toISOString(),
  });
  fireEvent.click(getByRole(container, "button", { name: "resumePresentationTimer" }));
  expect(onEntryAction).toHaveBeenCalledWith(
    expect.objectContaining({ id: 7 }),
    "resume-timer",
    undefined,
    "resumePresentationTimer",
  );
});

it("hides the timer control outside a legal presenting state", () => {
  render({ status: "completed" });
  expect(queryByRole(container, "button", { name: "pausePresentationTimer" })).toBeNull();
  expect(queryByRole(container, "button", { name: "resumePresentationTimer" })).toBeNull();
});
