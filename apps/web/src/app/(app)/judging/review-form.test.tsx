import type { Question } from "@hackos/shared/questions";
import { fireEvent, getByLabelText, getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QueueEntry } from "@/lib/queue";
import { ReviewForm } from "./review-form";

const queue = vi.hoisted(() => ({
  getReview: vi.fn(),
  getSessions: vi.fn(),
  getReviewVersions: vi.fn(),
  getReviewFieldLeases: vi.fn(),
  openSession: vi.fn(),
  closeSession: vi.fn(),
  acquireReviewFieldLease: vi.fn(),
  releaseReviewFieldLease: vi.fn(),
  saveReview: vi.fn(),
}));
vi.mock("@/lib/queue", () => queue);
vi.mock("./presentation-panel", () => ({ ProjectInfo: () => null }));
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia;
vi.mock("@/hooks/use-event-source", () => ({ useEventSource: vi.fn() }));
const t = (key: string) => key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const panel: Question[] = [
  {
    key: "score",
    kind: "scale",
    label: { en: "Score", es: "Score", gl: "Score" },
    min: 0,
    max: 10,
    required: false,
  },
  {
    key: "text",
    kind: "short_text",
    maxLength: 1000,
    label: { en: "Text", es: "Text", gl: "Text" },
    required: false,
  },
];
const entry = { id: 501 } as QueueEntry;
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.resetAllMocks();
  queue.getReview.mockResolvedValue({ scores: {}, notes: null, status: "draft" });
  queue.getSessions.mockResolvedValue([]);
  queue.getReviewVersions.mockResolvedValue([]);
  queue.getReviewFieldLeases.mockResolvedValue([]);
  queue.openSession.mockResolvedValue(null);
  queue.closeSession.mockResolvedValue(null);
  queue.acquireReviewFieldLease.mockResolvedValue({ field: "notes" });
  queue.releaseReviewFieldLease.mockResolvedValue(null);
  queue.saveReview.mockResolvedValue({ status: "draft" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <ReviewForm
        onClose={() => undefined}
        entry={entry}
        challenge={null}
        panel={panel}
        roomId={7}
        canJudge
      />,
    ),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it("saves numeric edits without untouched notes or text leases (H36)", async () => {
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "6" })));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenCalledWith(501, { scores: { score: 6 }, submit: false });
  expect(queue.acquireReviewFieldLease).not.toHaveBeenCalled();
});
it("holds unsaved notes on blur and refreshes their lease before saving (H36)", async () => {
  const notes = getByLabelText(document.body, "notesLabel");
  await act(async () => fireEvent.focusIn(notes));
  await act(async () => fireEvent.change(notes, { target: { value: "Pending notes" } }));
  await act(async () => fireEvent.focusOut(notes));
  expect(queue.releaseReviewFieldLease).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(queue.acquireReviewFieldLease).toHaveBeenCalledTimes(2);
  expect(queue.saveReview).toHaveBeenCalledWith(501, {
    scores: {},
    notes: "Pending notes",
    submit: false,
  });
  expect(queue.releaseReviewFieldLease).toHaveBeenCalledWith(501, "notes");
});
it("shows one inline error and preserves edits for retry (H36)", async () => {
  queue.saveReview.mockRejectedValueOnce(new Error("Save failed"));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "6" })));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(getByRole(document.body, "alert").textContent).toContain("couldNotSaveReview");
  expect(toast.error).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenLastCalledWith(501, { scores: { score: 6 }, submit: false });
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
});
it("keeps edits made while a previous save is in flight (H36)", async () => {
  let finish!: (value: { status: string }) => void;
  queue.saveReview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "6" })));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "7" })));
  await act(async () => finish({ status: "draft" }));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenLastCalledWith(501, { scores: { score: 7 }, submit: false });
});
it("does not write text owned by another judge and retries without losing it (H36)", async () => {
  const notes = getByLabelText(document.body, "notesLabel");
  await act(async () => fireEvent.focusIn(notes));
  await act(async () => fireEvent.change(notes, { target: { value: "Pending notes" } }));
  queue.acquireReviewFieldLease.mockRejectedValueOnce(new Error("Another judge owns this field"));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(queue.saveReview).not.toHaveBeenCalled();
  expect(getByRole(document.body, "alert")).toBeTruthy();
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenCalledWith(501, {
    scores: {},
    notes: "Pending notes",
    submit: false,
  });
});
it("does not reload local edits when the room read model refreshes (H36)", async () => {
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "6" })));
  await act(async () =>
    root.render(
      <ReviewForm
        onClose={() => undefined}
        entry={{ ...entry }}
        challenge={null}
        panel={[...panel]}
        roomId={7}
        canJudge
      />,
    ),
  );
  expect(queue.getReview).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenCalledWith(501, { scores: { score: 6 }, submit: false });
});
it("submits displayed numeric defaults without claiming untouched text (H36)", async () => {
  await act(async () =>
    fireEvent.click(getByRole(document.body, "button", { name: "submitReview" })),
  );
  expect(queue.saveReview).toHaveBeenCalledWith(501, { scores: { score: 0 }, submit: true });
  expect(queue.acquireReviewFieldLease).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const waitPastAutosave = () => act(() => new Promise((done) => setTimeout(done, 900)));

it.each([
  ["reusing the form", undefined],
  ["remounting the form by entry key", 502],
])("saves edits from the debounce window when switching entries by %s (#1014)", async (_, key) => {
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "6" })));
  await act(async () =>
    root.render(
      <ReviewForm
        onClose={() => undefined}
        key={key}
        entry={{ id: 502 } as QueueEntry}
        challenge={null}
        panel={panel}
        roomId={7}
        canJudge
      />,
    ),
  );
  await waitPastAutosave();
  expect(queue.saveReview).toHaveBeenCalledTimes(1);
  expect(queue.saveReview).toHaveBeenCalledWith(501, { scores: { score: 6 }, submit: false });
  expect(queue.closeSession).toHaveBeenCalledWith(501);
});

it("reports a flush that another judge's lease blocks instead of retrying it (#1014)", async () => {
  const notes = getByLabelText(document.body, "notesLabel");
  await act(async () => fireEvent.focusIn(notes));
  await act(async () => fireEvent.change(notes, { target: { value: "Pending notes" } }));
  queue.acquireReviewFieldLease.mockRejectedValueOnce(new Error("Another judge owns this field"));
  await act(async () =>
    root.render(
      <ReviewForm
        onClose={() => undefined}
        entry={{ id: 502 } as QueueEntry}
        challenge={null}
        panel={panel}
        roomId={7}
        canJudge
      />,
    ),
  );
  await waitPastAutosave();
  expect(queue.saveReview).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledTimes(1);
});

it("ignores a late review response for a previous entry (#1014)", async () => {
  const first = deferred<object>();
  const second = deferred<object>();
  queue.getReview.mockImplementation((id: number) => (id === 502 ? first.promise : second.promise));
  const show = (id: number) =>
    act(async () =>
      root.render(
        <ReviewForm
          onClose={() => undefined}
          entry={{ id } as QueueEntry}
          challenge={null}
          panel={panel}
          roomId={7}
          canJudge
        />,
      ),
    );
  await show(502);
  await show(503);
  await act(async () => second.resolve({ scores: {}, notes: "Team B", status: "draft" }));
  await act(async () => first.resolve({ scores: { score: 9 }, notes: "Team A", status: "draft" }));
  expect((getByLabelText(document.body, "notesLabel") as HTMLTextAreaElement).value).toBe("Team B");
  await act(async () =>
    fireEvent.click(getByRole(document.body, "button", { name: "submitReview" })),
  );
  expect(queue.saveReview).toHaveBeenCalledWith(503, { scores: { score: 0 }, submit: true });
});

it("keeps a failed autosave visible with a retry until a save succeeds (#1014)", async () => {
  const atRisk = vi.fn();
  await act(async () =>
    root.render(
      <ReviewForm
        onClose={() => undefined}
        entry={entry}
        challenge={null}
        panel={panel}
        roomId={7}
        canJudge
        onUnsavedEditsAtRisk={atRisk}
      />,
    ),
  );
  queue.saveReview.mockRejectedValueOnce(new Error("Save failed"));
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "6" })));
  await waitPastAutosave();
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "7" })));
  await waitPastAutosave();
  expect(queue.saveReview).toHaveBeenCalledTimes(1);
  expect(getByRole(document.body, "alert").textContent).toContain("couldNotSaveReview");
  expect(atRisk).toHaveBeenLastCalledWith(true);
  await act(async () => fireEvent.click(getByRole(document.body, "button", { name: "retry" })));
  expect(queue.saveReview).toHaveBeenLastCalledWith(501, { scores: { score: 7 }, submit: false });
  expect(document.body.querySelector('[role="alert"]')).toBeNull();
  expect(atRisk).toHaveBeenLastCalledWith(false);
});
