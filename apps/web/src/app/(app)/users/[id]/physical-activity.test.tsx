import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhysicalActivity } from "./physical-activity";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const getActivity = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ api: { get: getActivity } }));
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

  it("reloads when the profile event-stream nonce changes", async () => {
    await act(async () => {
      root.render(<PhysicalActivity userId={42} refreshKey={0} embedded />);
      await Promise.resolve();
    });
    expect(getActivity).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<PhysicalActivity userId={42} refreshKey={1} embedded />);
      await Promise.resolve();
    });
    expect(getActivity).toHaveBeenCalledTimes(2);
    expect(getActivity).toHaveBeenLastCalledWith("/api/users/42/activity");
  });
});
