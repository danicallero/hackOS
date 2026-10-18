import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { useProjectDraft } from "./use-project-draft";

const { saveDraft } = vi.hoisted(() => ({ saveDraft: vi.fn() }));
vi.mock("@/lib/native-projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native-projects")>();
  return { ...actual, nativeProjects: { ...actual.nativeProjects, saveDraft } };
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const project = { id: 1, revision: 3, responses: { summary: "initial" } };
let snapshot: ReturnType<typeof useProjectDraft>;
function Harness() {
  snapshot = useProjectDraft(project, (key) => key);
  return null;
}
let root: Root;
let node: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers();
  saveDraft.mockReset();
  node = document.createElement("div");
  root = createRoot(node);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("project autosave", () => {
  it("retains edits made during an in-flight save and uses the returned revision for the next save", async () => {
    let resolve!: (value: { revision: number; responses: Record<string, unknown> }) => void;
    saveDraft.mockReturnValueOnce(
      new Promise((next) => {
        resolve = next;
      }),
    );
    await act(async () => snapshot.change("summary", "first"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(saveDraft).toHaveBeenCalledWith(1, { summary: "first" }, 3);
    await act(async () => snapshot.change("summary", "newer"));
    await act(async () => resolve({ revision: 4, responses: { summary: "first" } }));
    expect(snapshot.values.summary).toBe("newer");
    expect(snapshot.state).toBe("unsaved");
    saveDraft.mockResolvedValueOnce({ revision: 5, responses: { summary: "newer" } });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(saveDraft).toHaveBeenLastCalledWith(1, { summary: "newer" }, 4);
    expect(snapshot.state).toBe("saved");
  });
  it("retains local answers and stops writing after a concurrent-edit conflict", async () => {
    saveDraft.mockRejectedValue(new ApiError(409, "conflict", "Another teammate saved changes"));
    await act(async () => snapshot.change("summary", "mine"));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(snapshot.values.summary).toBe("mine");
    expect(snapshot.error).toBe("projectDraftConflict");
    await act(async () => snapshot.change("summary", "still mine"));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
});
