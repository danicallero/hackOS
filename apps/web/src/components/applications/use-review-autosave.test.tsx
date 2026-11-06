import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn();
vi.mock("@/lib/api", () => ({ api: { put: (...args: unknown[]) => put(...args) } }));

import { useReviewAutosave } from "./use-review-autosave";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let current: ReturnType<typeof useReviewAutosave>;
function Harness({ responseId, onSaved }: { responseId: number; onSaved?: () => void }) {
  current = useReviewAutosave(responseId, true, { score: null, notes: "" }, onSaved);
  return null;
}

describe("useReviewAutosave", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    put.mockReset().mockResolvedValue({});
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("saves a local edit once after the pause, trimming empty notes to null", async () => {
    const onSaved = vi.fn();
    act(() => root.render(<Harness responseId={7} onSaved={onSaved} />));
    act(() => current.setScore(4));
    expect(current.saveState).toBe("saving");
    expect(put).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith("/api/responses/7/my-review", { score: 4, notes: null });
    expect(current.saveState).toBe("saved");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("does not save a reseeded or remotely applied value", async () => {
    act(() => root.render(<Harness responseId={7} />));
    act(() => {
      current.seed(7, { score: 3, notes: "n" });
    });
    act(() => {
      current.applyRemote({ score: 5, notes: "x", saveState: "saved" });
    });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(put).not.toHaveBeenCalled();
    expect(current.score).toBe(5);
  });

  it("ignores remote updates while the reviewer has unsaved edits", () => {
    act(() => root.render(<Harness responseId={7} />));
    act(() => current.setNotes("mine"));
    let applied = true;
    act(() => {
      applied = current.applyRemote({ score: 1, notes: "theirs", saveState: "saved" });
    });
    expect(applied).toBe(false);
    expect(current.notes).toBe("mine");
  });

  it("flushes an unsaved draft when moving to another response", () => {
    act(() => root.render(<Harness responseId={7} />));
    act(() => current.setScore(2));
    act(() => root.render(<Harness responseId={8} />));
    act(() => current.seed(8, { score: null, notes: "" }));
    expect(put).toHaveBeenCalledWith("/api/responses/7/my-review", { score: 2, notes: null });
    expect(current.score).toBeNull();
  });

  it("keeps the draft identity until the new response is seeded (H13)", () => {
    act(() => root.render(<Harness responseId={7} />));
    act(() => root.render(<Harness responseId={8} />));
    expect(current.responseId).toBe(7);
    act(() => current.seed(8, { score: 2, notes: "next applicant" }));
    expect(current.responseId).toBe(8);
    expect(current.notes).toBe("next applicant");
  });

  it("does not report an identical remote snapshot as a change (H13)", () => {
    act(() => root.render(<Harness responseId={7} />));
    let applied = true;
    act(() => {
      applied = current.applyRemote({ score: null, notes: "", saveState: "saved" });
    });
    expect(applied).toBe(false);
  });

  it("reports a failed save as an error state", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    put.mockRejectedValue(new Error("boom"));
    act(() => root.render(<Harness responseId={7} />));
    act(() => current.setScore(1));
    await act(() => vi.advanceTimersByTimeAsync(700));
    expect(current.saveState).toBe("error");
    log.mockRestore();
  });
});
