import { getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsChart } from "./stats-chart";

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  dispatchAction: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  isDisposed: () => false,
}));
vi.mock("echarts/core", () => ({ use: vi.fn(), init: () => chart }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const container = document.createElement("div");
let root: ReturnType<typeof createRoot>;
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(type: "pie" | "line" | "bar" = "pie") {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect() {},
    fillRect() {},
    getImageData: () => ({ data: [0, 0, 0, 255] }),
  } as unknown as CanvasRenderingContext2D);
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <StatsChart
        title="Attendance"
        type={type}
        data={[
          { label: "Morning", n: 5, series: "Attended" },
          { label: "Evening", n: 7, series: "Attended" },
          { label: "Evening", n: 3, series: "Absent" },
        ]}
      />,
    ),
  );
}

describe("statistics chart keyboard data alternative (H27)", () => {
  it("exposes exact values and every pie category through a native disclosure", async () => {
    mount();
    const disclosure = container.querySelector("details");
    expect(disclosure?.open).toBe(false);
    const summary = container.querySelector("summary")!;
    const user = userEvent.setup();
    // jsdom does not implement the browser summary keyboard default action.
    await act(async () => {
      await user.click(summary);
    });
    expect(disclosure?.open).toBe(true);
    expect(getByRole(container, "list", { name: "Attendance" }).textContent).toContain(
      "Attended: Morning: 5",
    );
    const checkbox = getByRole(container, "checkbox", { name: "Attended: Morning" });
    checkbox.focus();
    await act(async () => {
      await user.keyboard(" ");
    });
    expect(chart.dispatchAction).toHaveBeenCalledWith({
      type: "legendToggleSelect",
      name: "Attended: Morning",
    });
  });

  it("groups line filters by series and mirrors pointer legend changes", () => {
    mount("line");
    container.querySelector("details")!.open = true;
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    const listener = chart.on.mock.calls.find(([event]) => event === "legendselectchanged")?.[1];
    act(() => listener({ selected: { Attended: false, Absent: true } }));
    expect(
      (getByRole(container, "checkbox", { name: "Attended" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect((getByRole(container, "checkbox", { name: "Absent" }) as HTMLInputElement).checked).toBe(
      true,
    );
  });
});
