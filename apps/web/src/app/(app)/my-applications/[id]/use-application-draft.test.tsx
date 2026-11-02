import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyResponseDetail } from "../lib";

const { put, remove, success } = vi.hoisted(() => ({
  put: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { put, delete: remove },
}));
vi.mock("@/lib/toast", () => ({ toast: { success, error: vi.fn() } }));

import { useCallback, useEffect, useRef, useState } from "react";
import { useApplicationDraft } from "./use-application-draft";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const response: MyResponseDetail = {
  id: 1,
  user_id: 1,
  application_id: 4,
  status: "draft",
  responses: { answer: "initial" },
  decision_sent_at: null,
  confirmation_expires_at: null,
  confirmed_at: null,
  declined_at: null,
  submitted_at: null,
  created_at: "2026-09-27T00:00:00.000Z",
  updated_at: "2026-09-27T00:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

type Snapshot = {
  values: Record<string, unknown>;
  saveState: string;
  edit: (value: string) => void;
  discard: () => Promise<void>;
  discarding: boolean;
};

const translate = (key: string) => key;
function Harness({
  onSnapshot,
  initialResponse = response,
}: {
  onSnapshot: (snapshot: Snapshot) => void;
  initialResponse?: MyResponseDetail | null;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({ answer: "initial" });
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [saving, setSaving] = useState(false);
  const [answerRevision, setAnswerRevision] = useState(0);
  const latestAnswerRevision = useRef(0);
  const hasLocalEdits = useRef(false);
  const [currentResponse, setResponse] = useState<MyResponseDetail | null>(initialResponse);
  const [, setActionError] = useState<import("../lib").ActionError | null>(null);

  const { discardDraft, discarding } = useApplicationDraft({
    applicationId: 4,
    formOpen: true,
    response: currentResponse,
    responseError: null,
    editable: true,
    values,
    answerRevision,
    latestAnswerRevision,
    hasLocalEdits,
    saveState,
    saving,
    t: translate,
    setResponse,
    setValues,
    setSaving,
    setSaveState,
    setActionError,
  });

  const edit = useCallback((value: string) => {
    hasLocalEdits.current = true;
    latestAnswerRevision.current += 1;
    setAnswerRevision(latestAnswerRevision.current);
    setValues({ answer: value });
    setSaveState("unsaved");
  }, []);

  useEffect(() => {
    onSnapshot({ values, saveState, edit, discard: discardDraft, discarding });
  }, [edit, onSnapshot, saveState, values, discardDraft, discarding]);

  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useApplicationDraft", () => {
  let container: HTMLDivElement;
  let root: Root;
  let snapshot: Snapshot | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    put.mockReset();
    remove.mockReset();
    remove.mockResolvedValue(undefined);
    success.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness onSnapshot={(next) => (snapshot = next)} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("preserves a newer edit while an older autosave is in flight (#844)", async () => {
    const firstSave = deferred<MyResponseDetail>();
    const secondSave = deferred<MyResponseDetail>();
    put
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);

    act(() => snapshot?.edit("first answer"));
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(put).toHaveBeenCalledWith("/api/applications/4/response", {
      responses: { answer: "first answer" },
    });

    act(() => snapshot?.edit("newer answer"));
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(put).toHaveBeenCalledOnce();

    await act(async () =>
      firstSave.resolve({ ...response, responses: { answer: "first answer" } }),
    );
    await flush();

    expect(snapshot).toMatchObject({
      values: { answer: "newer answer" },
      saveState: "unsaved",
    });
    expect(success).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(put).toHaveBeenLastCalledWith("/api/applications/4/response", {
      responses: { answer: "newer answer" },
    });

    await act(async () =>
      secondSave.resolve({ ...response, responses: { answer: "newer answer" } }),
    );
    await flush();
    expect(snapshot).toMatchObject({ values: { answer: "newer answer" }, saveState: "saved" });
  });
  it("cancels a queued autosave and never creates a replacement after discarding", async () => {
    act(() => snapshot?.edit("unsaved answer"));
    await act(async () => {
      await snapshot?.discard();
    });
    expect(remove).toHaveBeenCalledWith("/api/applications/4/response");
    act(() => snapshot?.edit("late render"));
    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(put).not.toHaveBeenCalled();
    expect(snapshot?.discarding).toBe(true);
  });

  it("waits for an in-flight save before deleting and suppresses a newer queued save", async () => {
    const pending = deferred<MyResponseDetail>();
    put.mockReturnValueOnce(pending.promise);
    act(() => snapshot?.edit("saving answer"));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    act(() => snapshot?.edit("newer answer"));
    let discarded!: Promise<void>;
    act(() => {
      discarded = snapshot!.discard();
    });
    expect(remove).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(response);
      await discarded;
    });
    expect(remove).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(1400);
    });
    expect(put).toHaveBeenCalledOnce();
    expect(snapshot?.values).toEqual({ answer: "newer answer" });
  });

  it("waits for initial draft creation and prevents its late result from restarting creation", async () => {
    const pending = deferred<MyResponseDetail>();
    put.mockReturnValueOnce(pending.promise);
    act(() =>
      root.render(
        <Harness
          key="new"
          initialResponse={null}
          onSnapshot={(next) => {
            snapshot = next;
          }}
        />,
      ),
    );
    expect(put).toHaveBeenCalledOnce();
    let discarded!: Promise<void>;
    act(() => {
      discarded = snapshot!.discard();
    });
    expect(remove).not.toHaveBeenCalled();
    await act(async () => {
      pending.resolve(response);
      await discarded;
    });
    await flush();
    expect(remove).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
  });

  it("allows retry when deletion fails", async () => {
    remove.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await expect(snapshot!.discard()).rejects.toThrow("offline");
    });
    expect(snapshot?.discarding).toBe(false);
    await act(async () => {
      await snapshot?.discard();
    });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(snapshot?.discarding).toBe(true);
  });
});
