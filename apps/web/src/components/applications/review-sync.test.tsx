import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ReviewSyncMessage, useReviewSync } from "./review-sync";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function TestTab({
  applicationId,
  responseId,
  score,
  notes,
  onRemoteMessage,
}: {
  applicationId: number;
  responseId: number;
  score: number | null;
  notes: string;
  onRemoteMessage: (message: ReviewSyncMessage) => void;
}) {
  useReviewSync(
    applicationId,
    { responseId, score, notes, saveState: "saved", status: "review" },
    onRemoteMessage,
  );
  return null;
}

describe("useReviewSync", () => {
  let containerA: HTMLDivElement;
  let containerB: HTMLDivElement;
  let rootA: Root;
  let rootB: Root;

  beforeEach(() => {
    containerA = document.createElement("div");
    containerB = document.createElement("div");
    document.body.append(containerA, containerB);
    rootA = createRoot(containerA);
    rootB = createRoot(containerB);
  });

  afterEach(() => {
    act(() => {
      rootA.unmount();
      rootB.unmount();
    });
    containerA.remove();
    containerB.remove();
  });

  it("delivers a score change from one tab to another on the same application", async () => {
    const onMessageA = vi.fn();
    const onMessageB = vi.fn();

    await act(async () => {
      rootA.render(
        <TestTab
          applicationId={1}
          responseId={10}
          score={null}
          notes=""
          onRemoteMessage={onMessageA}
        />,
      );
      rootB.render(
        <TestTab
          applicationId={1}
          responseId={10}
          score={null}
          notes=""
          onRemoteMessage={onMessageB}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      rootA.render(
        <TestTab
          applicationId={1}
          responseId={10}
          score={4}
          notes="looks solid"
          onRemoteMessage={onMessageA}
        />,
      );
      await Promise.resolve();
    });

    expect(onMessageB).toHaveBeenCalledWith(
      expect.objectContaining({ responseId: 10, score: 4, notes: "looks solid" }),
    );
    // A receives B's initial mount broadcast (a real message from another
    // tab), but never its own re-broadcast of the score:4 update it posted
    // itself — that's the feedback-loop guard under test.
    expect(onMessageA).not.toHaveBeenCalledWith(expect.objectContaining({ score: 4 }));
  });

  it("never crosses applications — a different applicationId is a different channel", async () => {
    const onMessageA = vi.fn();
    const onMessageB = vi.fn();

    await act(async () => {
      rootA.render(
        <TestTab
          applicationId={1}
          responseId={10}
          score={null}
          notes=""
          onRemoteMessage={onMessageA}
        />,
      );
      rootB.render(
        <TestTab
          applicationId={2}
          responseId={10}
          score={null}
          notes=""
          onRemoteMessage={onMessageB}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      rootA.render(
        <TestTab
          applicationId={1}
          responseId={10}
          score={5}
          notes=""
          onRemoteMessage={onMessageA}
        />,
      );
      await Promise.resolve();
    });

    expect(onMessageB).not.toHaveBeenCalled();
  });

  it("stops delivering messages once a tab unmounts (channel cleanup)", async () => {
    const onMessageB = vi.fn();

    await act(async () => {
      rootA.render(
        <TestTab
          applicationId={3}
          responseId={20}
          score={null}
          notes=""
          onRemoteMessage={vi.fn()}
        />,
      );
      rootB.render(
        <TestTab
          applicationId={3}
          responseId={20}
          score={null}
          notes=""
          onRemoteMessage={onMessageB}
        />,
      );
      await Promise.resolve();
    });

    act(() => rootA.unmount());

    await act(async () => {
      rootB.render(
        <TestTab
          applicationId={3}
          responseId={20}
          score={2}
          notes=""
          onRemoteMessage={onMessageB}
        />,
      );
      await Promise.resolve();
    });

    expect(onMessageB).not.toHaveBeenCalled();
  });
});
