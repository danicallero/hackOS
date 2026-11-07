import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerStateForTests } from "@/lib/server-state";
import { PhysicalActivity } from "./physical-activity";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const getActivity = vi.hoisted(() => vi.fn());

const stream = vi.hoisted(() => ({ onEvent: () => {} }));

vi.mock("@/lib/api", () => ({ api: { get: getActivity }, isNotFoundError: () => false }));
vi.mock("@/hooks/use-event-source", () => ({
  useEventSource: (_scope: string, options: { onEvent: () => void }) => {
    stream.onEvent = options.onEvent;
    return { connected: true };
  },
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/data-table", () => ({
  DataTable: () => <div data-testid="activity-table" />,
}));
vi.mock("@/components/common/empty-state", () => ({ EmptyState: () => null }));
vi.mock("@/components/common/section-card", () => ({
  SectionCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/common/spinner", () => ({ Spinner: () => <span /> }));
vi.mock("@/components/common/status-badge", () => ({
  StatusBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("PhysicalActivity freshness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    resetServerStateForTests();
    getActivity.mockResolvedValue({ passes: [] });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    getActivity.mockReset();
  });

  it("reloads when the profile event stream reports a change", async () => {
    await act(async () => {
      root.render(<PhysicalActivity userId={42} embedded />);
      await Promise.resolve();
    });
    expect(getActivity).toHaveBeenCalledTimes(1);

    await act(async () => {
      stream.onEvent();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(getActivity).toHaveBeenCalledTimes(2);
    expect(getActivity.mock.calls[1]?.[0]).toBe("/api/users/42/activity");
  });
});
