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
    root.render(<ReviewForm entry={entry} challenge={null} panel={panel} roomId={7} canJudge />),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
it("saves numeric edits without untouched notes or text leases (H36)", async () => {
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "6" })));
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenCalledWith(501, { scores: { score: 6 }, submit: false });
  expect(queue.acquireReviewFieldLease).not.toHaveBeenCalled();
});
it("holds unsaved notes on blur and refreshes their lease before saving (H36)", async () => {
  const notes = getByLabelText(container, "notesLabel");
  await act(async () => fireEvent.focusIn(notes));
  await act(async () => fireEvent.change(notes, { target: { value: "Pending notes" } }));
  await act(async () => fireEvent.focusOut(notes));
  expect(queue.releaseReviewFieldLease).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
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
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "6" })));
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  expect(getByRole(container, "alert").textContent).toBe("couldNotSaveReview");
  expect(toast.error).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenLastCalledWith(501, { scores: { score: 6 }, submit: false });
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("keeps edits made while a previous save is in flight (H36)", async () => {
  let finish!: (value: { status: string }) => void;
  queue.saveReview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "6" })));
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "7" })));
  await act(async () => finish({ status: "draft" }));
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenLastCalledWith(501, { scores: { score: 7 }, submit: false });
});
it("does not write text owned by another judge and retries without losing it (H36)", async () => {
  const notes = getByLabelText(container, "notesLabel");
  await act(async () => fireEvent.focusIn(notes));
  await act(async () => fireEvent.change(notes, { target: { value: "Pending notes" } }));
  queue.acquireReviewFieldLease.mockRejectedValueOnce(new Error("Another judge owns this field"));
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  expect(queue.saveReview).not.toHaveBeenCalled();
  expect(getByRole(container, "alert")).toBeTruthy();
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenCalledWith(501, {
    scores: {},
    notes: "Pending notes",
    submit: false,
  });
});
it("does not reload local edits when the room read model refreshes (H36)", async () => {
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "6" })));
  await act(async () =>
    root.render(
      <ReviewForm entry={{ ...entry }} challenge={null} panel={[...panel]} roomId={7} canJudge />,
    ),
  );
  expect(queue.getReview).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "saveDraft" })));
  expect(queue.saveReview).toHaveBeenCalledWith(501, { scores: { score: 6 }, submit: false });
});
it("submits displayed numeric defaults without claiming untouched text (H36)", async () => {
  await act(async () => fireEvent.click(getByRole(container, "button", { name: "submitReview" })));
  expect(queue.saveReview).toHaveBeenCalledWith(501, { scores: { score: 0 }, submit: true });
  expect(queue.acquireReviewFieldLease).not.toHaveBeenCalled();
});
